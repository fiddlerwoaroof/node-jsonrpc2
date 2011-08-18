var sys = require('sys');
var http = require('http');

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

    // Report errors from the http client. This also prevents crashes since an exception is thrown if we don't handle this event.
    client.on('error', function(err) {
      callback(err);
    });

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
        var decoded = JSON.parse(buffer); // TODO: Check for invalid response from server
        if(decoded.hasOwnProperty('result')) {
          if (callback) 
            callback(null, decoded.result);
          
        } else {
          // Call error handler if it is set, otherwise call callback with error parameters
          if (errback) {
          	errback(decoded.error);
          } else if(callback) {
          	callback(decoded.error, null);
          }
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
// handlePOST
//===----------------------------------------------------------------------===//
Server.prototype.handlePOST = function(req, res) {
  var buffer = '';
  var self = this;
  var handle = function (buf) {
    
    var decoded = "";
    try {
    	decoded = JSON.parse(buf);
    } catch (e) {
    	return Server.handleError(-32700, "Parse Error", null, req, res);
    }
    

    // Check for the required fields, and if they aren't there, then
    // dispatch to the handleError function.    
    if(!(decoded.method && decoded.params && decoded.id)) {
      
      if (typeof(id) == "undefined") {
   		var id = null;
   	  } 
   	  
      return Server.handleError(-32600, "Invalid Request", decoded.id, req, res);
    }

    if(!self.functions.hasOwnProperty(decoded.method)) {
      return Server.handleError(-32601, "Method not found", decoded.id, req, res);
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

    Server.trace('<--', 'request (id ' + decoded.id + '): ' + 
                  decoded.method + '(' + decoded.params.join(', ') + ')');

    // Try to call the method, but intercept errors and call our
    // onFailure handler.
    var method = self.functions[decoded.method];
    var callback = function(result, errormessage) {
      if (errormessage) {
        Server.handleError(-32602, errormessage, decoded.id, req, res);
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
      return Server.handleError(-32603, err, decoded.id, req, res);
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
// handleError
//===----------------------------------------------------------------------===//
Server.handleError = function(code, message, id, req, res) {
  
  var encoded = JSON.stringify({
  	'jsonrpc': '2.0',
    'error': {
    	'code':code,
    	'message':message
    },
    'id': id
  });
  
  res.writeHead(400, {'Content-Type': 'text/plain',
                      'Content-Length': encoded.length,
                      'Allow': 'POST'});
  
  res.write(encoded);
  res.end();
  
  Server.trace('-->', 'Failure: ' + code + ': ' + message);
}


//===----------------------------------------------------------------------===//
// handleNonPOST
//===----------------------------------------------------------------------===//
Server.handleNonPOST = function(req, res) {
  
  var encoded = JSON.stringify({
  	'jsonrpc': '2.0',
    'error': {
    	'code':-32600,
    	'message':"Only POST is allowed."
    },
    'id': null
  });
  
  res.writeHead(405, {'Content-Type': 'text/plain',
                      'Content-Length': encoded.length,
                      'Allow': 'POST'});
  res.write(encoded);
  res.end();
}


module.exports.Server = Server;
module.exports.Client = Client;
