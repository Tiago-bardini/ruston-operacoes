/**
 * Ruston Operações — envio das reuniões do Google Meet para o sistema
 * =====================================================================
 * Roda na conta Google de quem está em cópia das reuniões.
 * De hora em hora: pega as reuniões que já terminaram (últimos 3 dias),
 * lê a transcrição / Anotações do Gemini anexadas no card e envia para
 * /api/reunioes-importar. O sistema identifica o cliente e a IA analisa.
 *
 * Instalação (uma vez):
 *   1. script.google.com > Novo projeto > cole este arquivo inteiro.
 *   2. Em TOKEN, cole o token do sistema (REUNIOES_INGEST_TOKEN).
 *   3. Menu lateral "Serviços" (+) > "Google Calendar API" > Adicionar.
 *   4. Escolha a função "instalar" no topo e clique em Executar. Autorize.
 * =====================================================================
 */

const URL_SISTEMA = 'https://ruston-operacoes.vercel.app/api/reunioes-importar';
const TOKEN = 'COLE_AQUI_O_TOKEN';
const DIAS_PARA_TRAS = 3;   // a transcrição às vezes chega minutos/horas depois
const LOTE = 5;             // reuniões por envio

/** Cria o gatilho de hora em hora e já roda a primeira vez. */
function instalar() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'enviarReunioes'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarReunioes').timeBased().everyHours(1).create();
  enviarReunioes();
}

function enviarReunioes() {
  const props = PropertiesService.getScriptProperties();
  const enviados = JSON.parse(props.getProperty('enviados') || '{}');
  const agora = new Date();
  const inicio = new Date(agora.getTime() - DIAS_PARA_TRAS * 24 * 3600 * 1000);

  const eventos = [];
  let pageToken;
  do {
    const resp = Calendar.Events.list('primary', {
      timeMin: inicio.toISOString(),
      timeMax: agora.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken: pageToken,
    });
    (resp.items || []).forEach(function (e) { eventos.push(e); });
    pageToken = resp.nextPageToken;
  } while (pageToken);

  const fila = [];
  eventos.forEach(function (e) {
    if (enviados[e.id]) return;
    if (e.status === 'cancelled') return;
    if (!e.hangoutLink && !(e.conferenceData && e.conferenceData.conferenceSolution)) return; // só Meet
    const fim = new Date(e.end.dateTime || e.end.date);
    if (fim > agora) return;                                                                    // ainda não terminou

    const transcricao = lerTranscricao(e);
    if (!transcricao) return; // tenta de novo na próxima hora, até sair da janela

    const participantes = (e.attendees || [])
      .filter(function (a) { return a.email && !a.resource; })
      .map(function (a) { return a.email; });
    if (e.organizer && e.organizer.email) participantes.push(e.organizer.email);

    fila.push({
      event_id: e.id,
      titulo: e.summary || '',
      inicio: e.start.dateTime || e.start.date,
      fim: e.end.dateTime || e.end.date,
      participantes: participantes,
      transcricao: transcricao,
    });
  });

  for (let i = 0; i < fila.length; i += LOTE) {
    const lote = fila.slice(i, i + LOTE);
    const res = UrlFetchApp.fetch(URL_SISTEMA, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + TOKEN },
      payload: JSON.stringify({ reunioes: lote }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error('Erro ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
      break;
    }
    const corpo = JSON.parse(res.getContentText());
    (corpo.resultados || []).forEach(function (r) {
      console.log((r.status || '?') + ' · ' + (r.cliente || '-') + ' · ' + r.event_id);
      if (r.event_id && r.status !== 'erro') enviados[r.event_id] = agora.getTime();
    });
  }

  // Esquece o que já saiu da janela, para a memória não crescer
  const limite = agora.getTime() - (DIAS_PARA_TRAS + 4) * 24 * 3600 * 1000;
  Object.keys(enviados).forEach(function (k) { if (enviados[k] < limite) delete enviados[k]; });
  props.setProperty('enviados', JSON.stringify(enviados));
  console.log('Reuniões enviadas nesta rodada: ' + fila.length);
}

/** Texto da transcrição e/ou Anotações do Gemini anexadas no evento. */
function lerTranscricao(evento) {
  const docs = (evento.attachments || []).filter(function (a) {
    return a.mimeType === 'application/vnd.google-apps.document' && a.fileId;
  });
  if (docs.length === 0) return null;

  // Transcrição primeiro, depois anotações (as duas ajudam a IA)
  const peso = function (a) {
    const t = (a.title || '').toLowerCase();
    if (t.indexOf('transcri') >= 0 || t.indexOf('transcript') >= 0) return 0;
    if (t.indexOf('anota') >= 0 || t.indexOf('notes') >= 0 || t.indexOf('gemini') >= 0) return 1;
    return 2;
  };
  docs.sort(function (a, b) { return peso(a) - peso(b); });

  const partes = [];
  docs.forEach(function (a) {
    if (peso(a) === 2) return; // outro documento qualquer anexado (pauta, proposta...)
    try {
      const texto = textoDoDocumento(DocumentApp.openById(a.fileId));
      if (texto && texto.trim()) partes.push('### ' + (a.title || 'Documento') + '\n' + texto.trim());
    } catch (err) {
      console.warn('Sem acesso ao documento "' + a.title + '": ' + err);
    }
  });
  return partes.length ? partes.join('\n\n') : null;
}

/** Junta o texto de todas as guias (as Anotações do Gemini põem a transcrição numa guia). */
function textoDoDocumento(doc) {
  if (typeof doc.getTabs !== 'function') return doc.getBody().getText();
  const textos = [];
  const visitar = function (tabs) {
    tabs.forEach(function (tab) {
      const dt = tab.asDocumentTab && tab.asDocumentTab();
      if (dt) textos.push(dt.getBody().getText());
      if (tab.getChildTabs) visitar(tab.getChildTabs());
    });
  };
  visitar(doc.getTabs());
  return textos.join('\n\n');
}
