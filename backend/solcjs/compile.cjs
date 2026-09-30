// Reads a solc standard-JSON input on stdin and writes solc's output on
// stdout, using the official WebAssembly build pinned in package.json.
// `--version` prints the compiler's version instead.
const solc = require('solc')

if (process.argv[2] === '--version') {
  process.stdout.write(solc.version())
} else {
  let input = ''
  process.stdin.on('data', (chunk) => (input += chunk))
  process.stdin.on('end', () => process.stdout.write(solc.compile(input)))
}
