const { parentPort } = require('worker_threads');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

parentPort.on('message', async ({ images }) => {
  try {
    for (const { inputPath, outputPath } of images) {
      const dir = path.dirname(outputPath);
      await fs.promises.mkdir(dir, { recursive: true });
      try {
        await sharp(inputPath)
          .resize({ width: 200 })
          .avif({ quality: 50 })
          .toFile(outputPath);
      } catch (err) {
        console.error(`Thumbnail error for ${inputPath}:`, err.message);
      }
    }

    parentPort.postMessage({ success: true });
  } catch (err) {
    parentPort.postMessage({ success: false, error: err.message });
  }
});
