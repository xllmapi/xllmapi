const { existsSync } = require('fs');
const { join } = require('path');

const platforms = [
  `secure-executor.${process.platform}-${process.arch}-${process.platform === 'linux' ? 'gnu' : 'unknown'}.node`,
  `secure-executor.${process.platform}-${process.arch}.node`,
];

let nativeBinding = null;
for (const name of platforms) {
  const path = join(__dirname, name);
  if (existsSync(path)) {
    nativeBinding = require(path);
    break;
  }
}

if (!nativeBinding) {
  throw new Error(`Failed to load native binding for ${process.platform}-${process.arch}. Tried: ${platforms.join(', ')}`);
}

module.exports = nativeBinding;
