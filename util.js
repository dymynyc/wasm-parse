var {OR} = require('stack-expression')
var varint = require('varint')

function Byte (byte, sym) {
  return function (input, start) {
    if(input[start] === byte) {
      return {length: 1, groups: sym ? sym : []}
    }
  }
}

//varint captures by default, since we generally want it.
function Varint (input, start) {
  var i = varint.decode(input, start)
  return {
    length: varint.decode.bytes,
    groups: i
  }
}

function id (e) { return e }

function Bytes (map) {
  return function (input, start, end) {
    var length = varint.decode(input, start)
    var bytes = varint.decode.bytes

    return {
      length: bytes+length,
      groups: [(map||id)(input.slice(start+bytes, start+bytes+length))]
    }
  }
}

function Bound (subrule, sym) {
  return function (input, start) {
    var length = varint.decode(input, start)
    var bytes = varint.decode.bytes
    var _start = start+bytes
    var count = varint.decode(input, _start)
    _start = _start+bytes
    var end = start + bytes + length
    var g = sym ? [sym]:[]
    while(_start < end) {
      var m = subrule(input, _start, end)
      g.push(m.groups)
      _start += m.length
    }
    return {
      length: end - start,
      groups: [g]
    }
  }
}


//a vector, bounded by a varint32
//I think it's byte length, not element length?
function LengthDelimited (subrule, sym) {
  return function (input, start) {
    var length = varint.decode(input, start)
    var bytes = varint.decode.bytes
    var _start = start+bytes
    var end = start + bytes + length
    var g = sym ? [sym]:[]
    while(_start < end) {
      var m = subrule(input, _start, end)
      g.push(m.groups)
      _start += m.length
    }
    return {
      length: end - start,
      groups: [g]
    }
  }
}

function CountDelimited (subrule, sym) {
  return function (input, start) {
    var count = varint.decode(input, start)
    var _start = start+varint.decode.bytes
    var g = []
    for(var i = 0; i < count; i++) {
      var m = subrule(input, _start)
      g.push(m.groups)
      _start += m.length
    }
    return {
      length: _start - start,
      groups: sym ? [sym, g] : g
    }
  }


}


var Name = Bytes(String)

module.exports = {
  Name, CountDelimited, LengthDelimited, Bound,
  Bytes, Varint, Byte,
}
