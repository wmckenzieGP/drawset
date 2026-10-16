import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Text recognition runs offline: the tesseract.js worker, its WebAssembly cores and the English language data
 * are shipped with the app under ocr/ (nothing is fetched from the internet).
 */
const OCR_ASSETS: Record<string, string> = {
  "ocr/worker.min.js": "node_modules/tesseract.js/dist/worker.min.js",
  "ocr/core/tesseract-core-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "ocr/core/tesseract-core-simd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js": "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "ocr/lang/eng.traineddata.gz": "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};

function ocrAssets(): Plugin {
  return {
    name: "drawset-ocr-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0].replace(/^\/+/, "");
        const file = OCR_ASSETS[url];
        if (!file) return next();
        res.setHeader("Content-Type", url.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        res.end(readFileSync(resolve(file)));
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(OCR_ASSETS)) this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(file)) });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), ocrAssets()],
  optimizeDeps: { exclude: ["mupdf"] },
  worker: { format: "es" },
  build: { target: "es2022", outDir: "dist", chunkSizeWarningLimit: 4000 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
