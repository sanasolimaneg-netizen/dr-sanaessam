// تجميع التطبيق كله في ملف index.html واحد:  npm install  ثم  npm run build
import fs from 'fs';
import * as esbuild from 'esbuild';

const r = await esbuild.build({
  entryPoints: ['src/main.jsx'], bundle: true, minify: true, write: false, format: 'iife',
  target: 'es2020', jsx: 'automatic', charset: 'utf8',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync('src/styles.css', 'utf8');
const tpl = fs.readFileSync('template.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', tpl.replace('/*CSS*/', () => css).replace('/*JS*/', () => js));
console.log('تم: dist/index.html');
