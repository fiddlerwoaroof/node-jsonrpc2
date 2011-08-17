var sys = require('sys');
var http = require('http');

var METHOD_NOT_ALLOWED = "Method Not Allowed\n";
var INVALID_REQUEST = "Invalid Request\n";


//===----------------------------------------------------------------------===//
// Server Client
//===----------------------------------------------------------------------===//
var Client = function(port, host, user, password) {
  this.port = port;
  this.host = host;
  this.user = user;
  this.password = password;
  
  this.call = function(method, params, callback, errback, path) {
    var client = http.createClient(port, host);
    
    // First we encode the request into JSON
    var requestJSON = JSON.stringify({
      'jsonrpc': '2.0',
      'id': '' + (new Date()).getTime(),
      'method': method,
      'params': params
    });
    
    var headers = {};

    if (user && password) {
      var buff = new Buffer(this.user + ":" + this.password)
                           .toString('base64');
      var auth = 'Basic ' + buff;
      headers['Authorization'] = auth;
    }

    // Then we build some basic headers.
    headers['Host'] = host;
    headers['Content-Length'] = requestJSON.length;

    // Now we'll make a request to the server
    var request = client.request('POST', path || '/', headers);
    request.write(requestJSON);
    request.on('response', function(response) {
      // We need to buffer the response chunks in a nonblocking way.
      var buffer = '';
      response.on('data', function(chunk) {
        buffer = buffer + chunk;
      });
      // When all the responses are finished, we decode the JSON and
      // depending on whether it's got a result or an error, we call
      // emitSuccess or emitError on the promise.
      response.on('end', function() {
        var decoded = JSON.parse(buffer);
        if(decoded.hasOwnProperty('result')) {
          if (callback)
            callback(null, decoded.result);
        }
        else {
          if (errback)
            errback(decoded.error);
        }
      });
    });
  };
}

//===----------------------------------------------------------------------===//
// Server
//===----------------------------------------------------------------------===//
function Server() {
  var self = this;
  this.functions = {};
  this.scopes = {};
  this.defaultScope = this;
  this.server = http.createServer(function(req, res) {
    Server.trace('<--', 'accepted request');
    if(req.method === 'POST') {
      self.handlePOST(req, res);
    }
    else {
      Server.handleNonPOST(req, res);
    }
  });
}


//===----------------------------------------------------------------------===//
// exposeModule
//===----------------------------------------------------------------------===//
Server.prototype.exposeModule = function(mod, object, scope) {
  var funcs = [];
  for(var funcName in object) {
    var funcObj = object[funcName];
    if(typeof(funcObj) == 'function') {
      this.functions[mod + '.' + funcName] = funcObj;
      funcs.push(funcName);

      if (scope) {
        this.scopes[mod + '.' + funcName] = scope;
      }
    }
  }
  Server.trace('***', 'exposing module: ' + mod + ' [funs: ' + funcs.join(', ') 
                + ']');
  return object;
}


//===----------------------------------------------------------------------===//
// expose
//===----------------------------------------------------------------------===//
Server.prototype.expose = function(name, func, scope) {
  Server.trace('***', 'exposing: ' + name);
  this.functions[name] = func;

  if (scope) {
    this.scopes[name] = scope;
  }
}


//===----------------------------------------------------------------------===//
// trace
//===----------------------------------------------------------------------===//
Server.trace = function(direction, message) {
  sys.puts('   ' + direction + '   ' + message);
}


//===----------------------------------------------------------------------===//
// listen
//===----------------------------------------------------------------------===//
Server.prototype.listen = function(port, host) { 
  this.server.listen(port, host);
  Server.trace('***', 'Server listening on http://' + (host || '127.0.0.1') + 
                ':' + port + '/'); 
}


//===----------------------------------------------------------------------===//
// handleInvalidRequest
//===----------------------------------------------------------------------===//
Server.handleInvalidRequest = function(req, res) {
  res.writeHead(400, {'Content-Type': 'text/plain',
                      'Content-Length': INVALID_REQUEST.length});
  res.write(INVALID_REQUEST);
  res.end();
}


//===----------------------------------------------------------------------===//
// handlePOST
//===----------------------------------------------------------------------===//
Server.prototype.handlePOST = function(req, res) {
  var buffer = '';
  var self = this;
  var handle = function (buf) {
    var decoded = JSON.parse(buf);

    // Check for the required fields, and if they aren't there, then
    // dispatch to the handleInvalidRequest function.
    if(!(decoded.method && decoded.params && decoded.id)) {
      return Server.handleInvalidRequest(req, res);
    }

    if(!self.functions.hasOwnProperty(decoded.method)) {
      return Server.handleInvalidRequest(req, res);
    }

    // Build our success handler
    var onSuccess = function(funcResp) {
      Server.trace('-->', 'response (id ' + decoded.id + '): ' + 
                    JSON.stringify(funcResp));

      var encoded = JSON.stringify({
        'jsonrpc': '2.0',
        'result': funcResp,
        'error': null,
        'id': decoded.id
      });
      res.writeHead(200, {'Content-Type': 'application/json',
                          'Content-Length': encoded.length});
      res.write(encoded);
      res.end();
    };

    // Build our failure handler (note that error must not be null)
    var onFailure = function(failure) {
      Server.trace('-->', 'failure: ' + JSON.stringify(failure));
      var encoded = JSON.stringify({
        'jsonrpc': '2.0',
        'result': null,
        'error': failure || 'Unspecified Failure',
        'id': decoded.id
      });
      res.writeHead(200, {'Content-Type': 'application/json',
                          'Content-Length': encoded.length});
      res.write(encoded);
      res.end();
    };

    Server.trace('<--', 'request (id ' + decoded.id + '): ' + 
                  decoded.method + '(' + decoded.params.join(', ') + ')');

    // Try to call the method, but intercept errors and call our
    // onFailure handler.
    var method = self.functions[decoded.method];
    var callback = function(err, result) {
      if (err) {
        onFailure(err);
      } else {
        onSuccess(result);
      }
    };
    var scope = self.scopes[decoded.method] || self.defaultScope;

    // Other various information we want to pass in for the handler to be
    // able to access.
    var opt = {
      req: req,
      server: self
    };

    try {
      method.call(scope, decoded.params, opt, callback);
    } catch (err) {
      return onFailure(err);
    }

  } // function handle(buf)

  req.addListener('data', function(chunk) {
    buffer = buffer + chunk;
  });

  req.addListener('end', function() {
    handle(buffer);
  });
}


//===----------------------------------------------------------------------===//
// handleNonPOST
//===----------------------------------------------------------------------===//
Server.handleNonPOST = function(req, res) {
  res.writeHead(405, {'Content-Type': 'text/plain',
                      'Content-Length': METHOD_NOT_ALLOWED.length,
                      'Allow': 'POST'});
  res.write(METHOD_NOT_ALLOWED);
  res.end();
}


module.exports.Server = Server;
module.exports.Client = Client;
