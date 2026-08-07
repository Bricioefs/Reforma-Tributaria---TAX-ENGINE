const fs = require('fs');
const path = require('path');

function copiarDiretorio(origem, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const item of fs.readdirSync(origem, { withFileTypes: true })) {
    const caminhoOrigem = path.join(origem, item.name);
    const caminhoDestino = path.join(destino, item.name);
    if (item.isDirectory()) {
      copiarDiretorio(caminhoOrigem, caminhoDestino);
    } else {
      fs.copyFileSync(caminhoOrigem, caminhoDestino);
    }
  }
}

copiarDiretorio(path.join(__dirname, '..', 'src', 'public'), path.join(__dirname, '..', 'dist', 'public'));
console.log('Pasta public copiada para dist/public');

copiarDiretorio(path.join(__dirname, '..', 'src', 'assets'), path.join(__dirname, '..', 'dist', 'assets'));
console.log('Pasta assets copiada para dist/assets');
