import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.join(__dirname, 'public', 'assets', 'logos');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Simple text-to-SVG generator for fallbacks
function generateTextSVG(text) {
  // Using a white outline for the text
  let fontSize = 40;
  if (text.length > 5) fontSize = 20;
  if (text.length > 10) fontSize = 15;
  
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">
    <text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="${fontSize}" fill="none" stroke="white" stroke-width="2" text-anchor="middle" dominant-baseline="middle">${text}</text>
  </svg>`;
}

const iconsToFetch = {
  'python': 'https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/python.svg',
  'javascript': 'https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/javascript.svg',
  'nodejs': 'https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/nodedotjs.svg',
  'threejs': 'https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/threedotjs.svg',
  'cursor': 'https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/cursor.svg',
};

const textLogos = {
  'uw': 'UW',
  'iu': 'IU',
  'harvard': 'HARVARD',
  'ktp': 'KTP',
  'antigravity': 'AG'
};

async function fetchURL(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Status Code: ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  for (const [name, url] of Object.entries(iconsToFetch)) {
    try {
      let svg = await fetchURL(url);
      // Inject fill="white" so it shows up on dark background
      svg = svg.replace('<svg ', '<svg fill="white" width="256" height="256" ');
      fs.writeFileSync(path.join(outDir, `${name}.svg`), svg);
      console.log(`Fetched ${name}`);
    } catch (e) {
      console.log(`Failed to fetch ${name}, using text fallback. Error: ${e.message}`);
      fs.writeFileSync(path.join(outDir, `${name}.svg`), generateTextSVG(name.toUpperCase()));
    }
  }

  for (const [name, text] of Object.entries(textLogos)) {
    fs.writeFileSync(path.join(outDir, `${name}.svg`), generateTextSVG(text));
    console.log(`Generated text SVG for ${name}`);
  }
}

run();
