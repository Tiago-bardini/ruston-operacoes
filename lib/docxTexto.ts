// Lê o texto de um .docx (ex.: "Anotações do Gemini") direto no navegador,
// sem biblioteca: o .docx é um zip; pega word/document.xml e tira as tags.

async function inflarRaw(dados: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([new Uint8Array(dados)]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function textoDoDocx(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);

  // Fim do diretório central (assinatura 0x06054b50), procurando de trás pra frente
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Arquivo .docx inválido");
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  const dec = new TextDecoder();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const lenNome = dv.getUint16(p + 28, true);
    const lenExtra = dv.getUint16(p + 30, true);
    const lenCom = dv.getUint16(p + 32, true);
    const offLocal = dv.getUint32(p + 42, true);
    const nome = dec.decode(buf.subarray(p + 46, p + 46 + lenNome));
    if (nome === "word/document.xml") {
      const ini = offLocal + 30 + dv.getUint16(offLocal + 26, true) + dv.getUint16(offLocal + 28, true);
      const comp = buf.subarray(ini, ini + tamComp);
      const xml = dec.decode(metodo === 0 ? comp : await inflarRaw(comp));
      return xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    p += 46 + lenNome + lenExtra + lenCom;
  }
  throw new Error("Não achei o texto dentro do .docx");
}
