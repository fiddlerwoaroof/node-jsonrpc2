var rpc = require('../src/jsonrpc');

var server = new rpc.Server();

/* Create two simple functions */
function add(args, opts, callback) {
  callback(args[0]+args[1]);
}

function multiply(args, opts, callback) {
  callback(args[0]*args[1]);
}

/* Expose those methods */
server.expose('add', add);
server.expose('multiply', multiply);

/* We can expose entire modules easily */
var math = {
  power: function(args, opts, callback) {
    callback(Math.pow(args[0], args[1]));
  },
  sqrt: function(args, opts, callback) {
    callback(Math.sqrt(args[0]));
  }
}
server.exposeModule('math', math);

/* Listen on port 8088 */
server.listen(8088, 'localhost');

/* By using a callback, we can delay our response indefinitely, leaving the
 request hanging until the callback emits success. */
var delayed = {
  echo: function(args, opts, callback) {
    var data = args[0];
    var delay = args[1];
    setTimeout(function() {
      callback(data);
    }, delay);
  },

  add: function(args, opts, callback) {
    var first = args[0];
    var second = args[1];
    var delay = args[2];
    setTimeout(function() {
      callback(first + second);
    }, delay);
  }
}

server.exposeModule('delayed', delayed);


// We can also add error parameters to our callback
// if something went wrong
function wrong(arg, opts, callback) {
	callback(null, "This will ever go wrong.")
}
server.expose('wrong', wrong);

