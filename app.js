// Importações do Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    updatePassword,
    createUserWithEmailAndPassword,
    reauthenticateWithCredential,
    EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    addDoc, 
    setDoc, 
    updateDoc, 
    deleteDoc, 
    onSnapshot, 
    collection, 
    query, 
    writeBatch,
    setLogLevel,
    getDocs, 
    where,
    arrayUnion,
    arrayRemove
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
// --- Configuração e Variáveis Globais do Firebase ---
let app, auth, db;

// [CORREÇÃO] Usando a constante FIREBASE_CONFIG e o appId hardcoded
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCb0Dhh_eMHrs_Dyg1wS5nbMu1U6tKHa3A",
    authDomain: "gestaoradios-58b0a.firebaseapp.com",
    projectId: "gestaoradios-58b0a",
    storageBucket: "gestaoradios-58b0a.firebasestorage.app",
    messagingSenderId: "359260635463",
    appId: "1:359260635463:web:1c3ac47eebcd3434818c62",
    measurementId: "G-DVXXT79TZK"
};
const appId = "gestaoradios-58b0a"; // [CORREÇÃO] appId hardcoded

let userId;
let isAuthReady = false;	
let firestoreListeners = [];	

// --- Variáveis de Estado Global (App) ---
let currentUser = null;	
let currentPage = 'login';
let currentLoginView = 'login'; // 'login' ou 'solicitar'
let currentCadastroTab = 'radio';
let currentSettingTab = 'system'; 
let isLoggingIn = false;
// 🌟 NOVO: Aumentado de 6 para 10
const PAGE_SIZE = 10; 
// NOVO: Armazena usuários aguardando aprovação
let pendingUsers = [];
// 🌟 NOVO: Armazena duplicidades críticas
let duplicities = [];

// Paginação e Busca
// 🌟 ATUALIZADO: bordosPage adicionado
let radioPage = 1, equipamentoPage = 1, bordosPage = 1, geralPage = 1, pesquisaPage = 1; 
const PESQUISA_PAGE_SIZE = 10; // 🌟 NOVO: Tamanho fixo para pesquisa
// 🌟 ATUALIZADO: bordosSearch adicionado
let radioSearch = '', equipamentoSearch = '', bordosSearch = '', geralSearch = '';
let focusedSearchInputId = null;
let searchCursorPosition = 0;
let searchTermPesquisa = ''; // 🌟 NOVO: Termo de busca da aba Pesquisa
let pesquisaReport = null; // 🌟 NOVO: Registro selecionado para mini relatório

// Constantes de Configuração
const GROUPS = ['Colheita', 'Transporte', 'Oficina', 'TPL', 'Industria'];
// 🌟 ATUALIZADO: Status de Rádio e Bordo (Incluindo Sinistro)
const DISPONIBLE_STATUSES = ['Disponível', 'Manutenção', 'Sinistro']; 
// 🌟 NOVO: Tipos de Bordos
const TIPOS_BORDO = ['Tela', 'Mag', 'Chip'];
const DEFAULT_LETTER_MAP = {
    Colheita: 'A',
    Transporte: 'B', 
    Oficina: 'C',
    TPL: 'D',
    Industria: 'NUM'
};
const DEFAULT_NEXT_INDEX = { A: 1, B: 1, C: 1, D: 1, NUM: 1 };

// E-mail do Administrador Principal (Corrigido para o email do usuário no último contexto)
const ADMIN_PRINCIPAL_EMAIL = 'julianotimoteo@usinapitangueiras.com.br';

// --- Estado do Banco de Dados (In-memory Cache) ---
let dbRadios = [];
let dbEquipamentos = [];
// 🌟 NOVO: Cache de Bordos
let dbBordos = [];
let dbRegistros = [];
let settings = {
    letterMap: DEFAULT_LETTER_MAP,
    nextIndex: DEFAULT_NEXT_INDEX,
    users: []	
};

// --- PWA: Variável para prompt de instalação ---
let deferredPrompt;

// 🌟 NOVO: Cache offline para dados da Pesquisa
const CACHE_KEY = 'linkfrota_cache';
const CACHE_TIME_KEY = 'linkfrota_cache_time';
const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 horas

function saveDataCache() {
    const data = {
        registros: dbRegistros,
        radios: dbRadios,
        equipamentos: dbEquipamentos,
        bordos: dbBordos
    };
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
    } catch (e) {
        console.warn('Erro ao salvar cache:', e);
    }
}

function loadDataCache() {
    const timeStr = localStorage.getItem(CACHE_TIME_KEY);
    if (!timeStr) return false;
    const elapsed = Date.now() - parseInt(timeStr);
    if (elapsed > CACHE_DURATION) {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIME_KEY);
        return false;
    }
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return false;
        const data = JSON.parse(cached);
        dbRegistros = data.registros || [];
        dbRadios = data.radios || [];
        dbEquipamentos = data.equipamentos || [];
        dbBordos = data.bordos || [];
        return true;
    } catch (e) {
        return false;
    }
}

async function saveDataCacheFile() {
    const data = {
        exportadoEm: new Date().toISOString(),
        registros: dbRegistros,
        equipamentos: dbEquipamentos,
        radios: dbRadios,
        bordos: dbBordos
    };
    const json = JSON.stringify(data, null, 2);

    // OPFS (Origin Private File System): salva cadastro.json sem pedir permissão
    // O arquivo fica no sandbox do navegador, disponível offline
    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('cadastro.json', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
    } catch (e) {
        // OPFS não disponível (Safari) — usa só localStorage, sem arquivo físico
        console.warn('OPFS indisponível, salvando apenas em localStorage:', e);
    }
}

// 🌟 NOVO: Variáveis para controle do Prompt PWA
const PWA_PROMPT_KEY = 'pwa_prompt_dismissed';
let pwaTimeoutId = null; 

// --- Constantes de Tooltip para Importação ---
const RADIO_IMPORT_INFO = `
    O arquivo CSV ou XLSX deve conter as seguintes colunas obrigatórias:
    <ul class="list-disc list-inside mt-2 space-y-1">
        <li class="font-semibold">Numero de Serie</li>
        <li class="font-semibold">Modelo</li>
    </ul>
    Outras colunas serão ignoradas.
`;

const EQUIPAMENTO_IMPORT_INFO = `
    O arquivo CSV ou XLSX deve conter as seguintes colunas obrigatórias:
    <ul class="list-disc list-inside mt-2 space-y-1">
        <li class="font-semibold">Frota</li>
        <li class="font-semibold">Grupo (Deve ser um dos: Colheita, Transporte, Oficina, TPL, Industria)</li>
        <li class="font-semibold">Modelo do Equipamento</li>
        <li class="font-semibold">Subgrupo (Descrição do Equipamento)</li>
    </ul>
    <p class="mt-2"><span class="font-semibold">Coluna Opcional:</span> Gestor</p>
`;

// 🌟 NOVO: Constante de Tooltip para Bordos
const BORDO_IMPORT_INFO = `
    O arquivo CSV ou XLSX deve conter as seguintes colunas obrigatórias:
    <ul class="list-disc list-inside mt-2 space-y-1">
        <li class="font-semibold">Tipo (Deve ser: Tela, Mag ou Chip)</li>
        <li class="font-semibold">Numero de Serie</li>
        <li class="font-semibold">Modelo</li>
    </ul>
    <p class="mt-2 text-red-500 font-semibold">Atenção: A coluna "Tipo" deve ter um dos valores exatos: Tela, Mag ou Chip.</p>
`;

const VINCULO_IMPORT_INFO = `
    <p class="text-sm text-gray-600 dark:text-gray-300 mb-2">
        <strong>Colunas:</strong> Código, Frota, Série Rádio, Modelo Rádio, Grupo, Tela, Modelo Tela, Mag, Modelo Mag, Chip, Gestor.
    </p>
    <p class="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 p-2 rounded border border-amber-300 dark:border-amber-700">
        ⚠ Cada componente tem sua própria coluna de Série e Modelo. Tela+Mag+Chip devem vir juntos ou nenhum. Use o botão <strong>"Baixar Modelo"</strong> para obter a planilha no formato correto.
    </p>
`;

function handleImport(type, event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';
    const reader = new FileReader();
    reader.onload = function(e) {
        const data = e.target.result;
        if (file.name.endsWith('.csv')) {
            Papa.parse(data, { header: true, skipEmptyLines: true,
                complete: function(results) { processGenericImport(type, results.data); }
            });
        } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const wb = XLSX.read(data, { type: 'binary' });
            processGenericImport(type, XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
        } else {
            showModal('Erro', 'Formato não suportado. Use CSV ou XLSX.', 'error');
        }
    };
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) reader.readAsBinaryString(file);
    else reader.readAsText(file);
}

async function processGenericImport(type, rows) {
    if (!rows || rows.length === 0) {
        showModal('Aviso', 'O arquivo está vazio.', 'warning');
        return;
    }
    
    try {
        let count = 0;
        if (type === 'vinculos') {
            await processImportVinculos(rows);
            updateState();
            return;
        } else if (type === 'equipamentos') {
            // 🌟 CORREÇÃO: import de Equipamentos tem regras próprias (atualiza por Frota,
            // sem mexer em rádio/bordo/vínculo) — ver processImportEquipamentos().
            await processImportEquipamentos(rows);
            updateState();
            return;
        } else {
            for (const row of rows) {
                if (type === 'radios') {
                    await saveRadio({...row});
                    count++;
                } else if (type === 'bordos') {
                    await saveBordo({...row});
                    count++;
                }
            }
        }
        showModal('Sucesso', `${count} itens de ${type} importados com sucesso!`, 'success');
        updateState();
    } catch (error) {
        console.error('Erro na importação:', error);
        showModal('Erro', 'Ocorreu um erro ao processar a importação.', 'error');
    }
}

/**
 * 🌟 CORREÇÃO: Importação de Equipamentos por planilha (CSV/XLSX).
 *
 * Antes desta correção, o import chamava `saveEquipamento(...)`, uma função que
 * NUNCA existiu no projeto — todo import de Equipamentos falhava silenciosamente
 * (ReferenceError capturado pelo try/catch do handleImport, sem gravar nada).
 *
 * REGRAS DE NEGÓCIO (conforme solicitado):
 *  - O casamento de cada linha é feito pela coluna "Frota" (chave única).
 *  - Se a Frota já existir no cadastro: atualiza SOMENTE Grupo, Modelo do
 *    Equipamento e Subgrupo (e Gestor, se essa coluna vier preenchida na
 *    planilha). Nenhum outro campo é tocado — o merge é parcial (Firestore
 *    setDoc com { merge: true }), então o `id` do equipamento, o `ativo`,
 *    o `createdAt`, e principalmente os dados de Rádio (série/modelo),
 *    Bordo e o "código" de vínculo da Frota (que vivem nas coleções
 *    `radios`, `bordos` e `registros`, totalmente separadas) permanecem
 *    intocados.
 *  - Colunas ausentes ou em branco na planilha NÃO apagam o valor já
 *    cadastrado (célula vazia = "não mexer nesse campo").
 *  - Se a Frota não existir, um novo equipamento é criado — nesse caso
 *    Grupo, Modelo e Subgrupo são obrigatórios.
 *  - Linhas sem "Frota" preenchida são ignoradas.
 */
async function processImportEquipamentos(rows) {
    if (!db || !appId) { showModal('Erro', 'Conexão com o banco de dados perdida.', 'error'); return; }
    if (!rows || rows.length === 0) { showModal('Aviso', 'O arquivo está vazio.', 'warning'); return; }

    // Aceita nomes de coluna com pequenas variações (maiúsculas/minúsculas, "Modelo" vs "Modelo do Equipamento")
    const getVal = (row, ...keys) => {
        for (const k of keys) {
            if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
                return String(row[k]).trim();
            }
        }
        return '';
    };

    const colPath = `artifacts/${appId}/public/data/equipamentos`;
    const totalRows = rows.length;

    showProgressModal('Importando Equipamentos',
        `<p class="text-sm text-gray-600 dark:text-gray-300">Processando <strong>${totalRows}</strong> linha(s)...</p>`
    );

    let batch = writeBatch(db);
    let opsInBatch = 0;
    const batches = [];
    let updated = 0, created = 0, skipped = 0;
    const avisos = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const frota = getVal(row, 'Frota', 'frota');

        if (!frota) { skipped++; continue; }

        const grupoRaw = getVal(row, 'Grupo', 'grupo');
        const modelo   = getVal(row, 'Modelo do Equipamento', 'Modelo', 'modelo');
        const subgrupo = getVal(row, 'Subgrupo', 'subgrupo');
        const gestor   = getVal(row, 'Gestor', 'gestor');

        // Só entram no objeto de atualização os campos que realmente vieram na planilha
        const updates = {};
        if (grupoRaw) {
            const grupoMatch = GROUPS.find(g => g.toLowerCase() === grupoRaw.toLowerCase());
            if (grupoMatch) {
                updates.grupo = grupoMatch;
            } else {
                avisos.push(`Frota ${frota}: Grupo "${grupoRaw}" inválido (não alterado). Use um de: ${GROUPS.join(', ')}.`);
            }
        }
        if (modelo)   updates.modelo = modelo;
        if (subgrupo) updates.subgrupo = subgrupo;
        if (gestor)   updates.gestor = gestor;

        const existing = dbEquipamentos.find(eq => String(eq.frota || '').trim() === frota);

        if (existing) {
            // ATUALIZA em cima do equipamento já existente — nunca cria um novo id,
            // nunca mexe em rádio/bordo/registro de vínculo (outras coleções).
            if (Object.keys(updates).length > 0) {
                const docRef = doc(db, colPath, existing.id);
                batch.set(docRef, updates, { merge: true });
                opsInBatch++;
                updated++;
            } else {
                skipped++;
            }
        } else {
            // CRIA um equipamento novo — exige os 3 campos obrigatórios
            if (!updates.grupo || !updates.modelo || !updates.subgrupo) {
                avisos.push(`Frota ${frota}: não encontrada no cadastro e faltam dados obrigatórios (Grupo/Modelo/Subgrupo) para criá-la — linha ignorada.`);
                skipped++;
                continue;
            }
            const newRef = doc(collection(db, colPath));
            batch.set(newRef, {
                frota,
                grupo: updates.grupo,
                modelo: updates.modelo,
                subgrupo: updates.subgrupo,
                gestor: updates.gestor || 'Sem Gestor',
                ativo: true,
                createdAt: new Date().toISOString()
            });
            opsInBatch++;
            created++;
        }

        if (opsInBatch >= 450) {
            batches.push(batch);
            batch = writeBatch(db);
            opsInBatch = 0;
        }

        if (i % 25 === 0) {
            updateImportProgress(
                `<p class="text-sm text-gray-600 dark:text-gray-300">Processando linha <strong>${i + 1}</strong> de <strong>${totalRows}</strong>...</p>`,
                Math.round((i / totalRows) * 90)
            );
        }
    }
    if (opsInBatch > 0) batches.push(batch);

    try {
        for (let b = 0; b < batches.length; b++) {
            updateImportProgress(
                `<p class="text-sm text-gray-600 dark:text-gray-300">Gravando alterações (lote ${b + 1}/${batches.length})...</p>`,
                90 + Math.round(((b + 1) / batches.length) * 10)
            );
            await batches[b].commit();
        }

        await refreshDataFromFirestore();

        let msg = `<p><strong>${updated}</strong> equipamento(s) atualizado(s) e <strong>${created}</strong> criado(s).</p>`;
        if (skipped > 0) msg += `<p class="mt-1">${skipped} linha(s) ignorada(s) (sem Frota preenchida ou dados insuficientes).</p>`;
        if (avisos.length > 0) {
            msg += `<p class="mt-2 text-amber-600 font-semibold">Avisos:</p><ul class="list-disc list-inside text-sm mt-1">${avisos.slice(0, 15).map(a => `<li>${a}</li>`).join('')}</ul>`;
            if (avisos.length > 15) msg += `<p class="text-xs mt-1">(+${avisos.length - 15} outro(s) aviso(s))</p>`;
        }
        showModal(avisos.length > 0 ? 'Importação concluída com avisos' : 'Sucesso', msg, avisos.length > 0 ? 'warning' : 'success');
    } catch (err) {
        console.error('Erro ao importar equipamentos:', err);
        showModal('Erro', 'Falha ao gravar os equipamentos importados no banco de dados. Tente novamente.', 'error');
    }
}
    
    
async function processImportVinculos(rows) {
    if (!db || !appId) { showModal('Erro', 'Conexão com o banco de dados perdida.', 'error'); return; }

    const radiosBySerie    = {};
    dbRadios.forEach(r    => { radiosBySerie[String(r.serie || '').trim().toUpperCase()] = r; });
    const equipsByFrota    = {};
    dbEquipamentos.forEach(e => { equipsByFrota[String(e.frota || '').trim().toUpperCase()] = e; });
    const bordosByKey      = {};
    dbBordos.forEach(b    => { bordosByKey[`${(b.tipo||'').toUpperCase()}||${String(b.numeroSerie||'').trim().toUpperCase()}`] = b; });

    const equipsJaVinculados = new Set(dbRegistros.map(r => r.equipamentoId));

    const colEquip    = `artifacts/${appId}/public/data/equipamentos`;
    const colRadios   = `artifacts/${appId}/public/data/radios`;
    const colBordos   = `artifacts/${appId}/public/data/bordos`;
    const colRegistros= `artifacts/${appId}/public/data/registros`;

    const batches = [];
    let currentBatch = writeBatch(db);
    let opCount = 0;
    const pushOp = (fn) => {
        fn(currentBatch);
        opCount++;
        if (opCount >= 490) { batches.push(currentBatch); currentBatch = writeBatch(db); opCount = 0; }
    };

    const totalLinhas = rows.length;
    const log = { equipCriados: 0, radiosCriados: 0, bordosCriados: 0, vinculos: 0, avisos: [] };
    const frotasNesteArquivo = new Set();
    const seriesRadioNesteArquivo = new Set();

    let progressCount = 0;
    const progressStep = Math.max(1, Math.floor(totalLinhas / 100));

    showProgressModal('Importando Vínculos',
        `<p class="text-sm text-gray-600 dark:text-gray-300">Processando <strong>${totalLinhas}</strong> linha(s)...</p>`
    );

    for (const row of rows) {
        progressCount++;
        if (progressCount % progressStep === 0 || progressCount === totalLinhas) {
            const pct = Math.round((progressCount / totalLinhas) * 100);
            updateImportProgress(
                `<p class="text-sm text-gray-600 dark:text-gray-300">Processando linha <strong>${progressCount}</strong> de <strong>${totalLinhas}</strong>...</p>` +
                `<p class="text-xs text-gray-400 mt-1">${log.equipCriados} equipamentos · ${log.radiosCriados} rádios · ${log.bordosCriados} bordos · ${log.vinculos} vínculos</p>`,
                pct
            );
        }
        const v = (col) => String(row[col] || '').trim();
        const codigo       = v('Código');
        const frota        = v('Frota').toUpperCase();
        const grupo        = v('Grupo');
        const gestor       = v('Gestor');

        const radioData    = { serie: v('Série Rádio').toUpperCase(), modelo: v('Modelo Rádio') };
        const telaData     = { serie: v('Tela').toUpperCase(),        modelo: v('Modelo Tela') };
        const magData      = { serie: v('Mag').toUpperCase(),         modelo: v('Modelo Mag') };
        const chipSerie    = v('Chip').toUpperCase();

        if (!frota && !radioData.serie && !telaData.serie && !magData.serie && !chipSerie) {
            log.avisos.push('Linha ignorada: sem Frota e sem dados de vínculo.');
            continue;
        }

        if (frota && frotasNesteArquivo.has(frota)) {
            log.avisos.push(`Frota <b>${frota}</b>: duplicada no arquivo — ignorada.`);
            continue;
        }
        if (frota) frotasNesteArquivo.add(frota);

        let equipamento = frota ? equipsByFrota[frota] : null;

        if (frota && !equipamento) {
            if (!grupo) {
                log.avisos.push(`Frota <b>${frota}</b>: equipamento não existe e Grupo não informado — não foi possível criar.`);
                continue;
            }
            if (!GROUPS.includes(grupo)) {
                log.avisos.push(`Frota <b>${frota}</b>: Grupo "<b>${grupo}</b>" inválido.`);
                continue;
            }
            const newRef = doc(collection(db, colEquip));
            const equipCode = codigo || generateCode(grupo);
            const newEquip = { id: newRef.id, frota, grupo, modelo: '', subgrupo: '', gestor: gestor || 'Sem Gestor', ativo: true, createdAt: new Date().toISOString() };
            if (equipCode) newEquip.codigo = equipCode;
            pushOp(b => b.set(newRef, newEquip));
            equipsByFrota[frota] = newEquip;
            equipamento = newEquip;
            log.equipCriados++;
        }

        if (!equipamento) {
            log.avisos.push(frota ? `Frota <b>${frota}</b>: equipamento não encontrado no banco.` : 'Frota não informada — equipamento não encontrado.');
            continue;
        }

        if (equipsJaVinculados.has(equipamento.id)) {
            log.avisos.push(`Frota <b>${frota}</b>: já possui vínculo ativo — ignorado.`);
            continue;
        }

        if (gestor && equipamento.gestor !== gestor) {
            pushOp(b => b.update(doc(db, colEquip, equipamento.id), { gestor }));
            equipamento.gestor = gestor;
        }

        if (!equipamento.codigo) {
            const codeToSet = codigo || generateCode(equipamento.grupo);
            if (codeToSet) {
                equipamento.codigo = codeToSet;
                pushOp(b => b.update(doc(db, colEquip, equipamento.id), { codigo: codeToSet }));
            }
        }

        const serieRadStr = radioData.serie;
        const modeloRad   = radioData.modelo;
        let radioObj = null;

        if (serieRadStr) {
            if (seriesRadioNesteArquivo.has(serieRadStr)) {
                log.avisos.push(`Frota <b>${frota}</b>: Rádio <b>${serieRadStr}</b> já usado no arquivo — ignorado.`);
            } else {
                radioObj = radiosBySerie[serieRadStr];
                if (!radioObj) {
                    if (!modeloRad) {
                        log.avisos.push(`Frota <b>${frota}</b>: Rádio <b>${serieRadStr}</b> não cadastrado — modelo não informado, não foi possível criar.`);
                    } else {
                        const newRef = doc(collection(db, colRadios));
                        radioObj = { id: newRef.id, serie: serieRadStr, modelo: modeloRad, status: 'Disponível', ativo: true, createdAt: new Date().toISOString() };
                        pushOp(b => b.set(newRef, radioObj));
                        radiosBySerie[serieRadStr] = radioObj;
                        log.radiosCriados++;
                    }
                }
                if (radioObj) seriesRadioNesteArquivo.add(serieRadStr);
            }
        }

        const criarOuBuscarBordo = (tipo, serieStr, modelo) => {
            if (!serieStr) return null;
            const key = `${tipo.toUpperCase()}||${serieStr}`;
            let b = bordosByKey[key];
            if (!b) {
                const newRef = doc(collection(db, colBordos));
                b = { id: newRef.id, tipo, numeroSerie: serieStr, modelo: modelo || '', status: 'Disponível', ativo: true, createdAt: new Date().toISOString() };
                pushOp(bch => bch.set(newRef, b));
                bordosByKey[key] = b;
                log.bordosCriados++;
            }
            return b;
        };

        const serieTelStr = telaData.serie;
        const modeloTela  = telaData.modelo;
        const serieMagStr = magData.serie;
        const modeloMag   = magData.modelo;

        const temAlgumBordo = serieTelStr || serieMagStr || chipSerie;
        let telaObj = null, magObj = null, chipObj = null;

        const criarOuBuscarChip = (serie) => {
            if (!serie) return;
            let b = bordosByKey[`CHIP||${serie}`];
            if (b) return;
            const newRef = doc(collection(db, colBordos));
            b = { id: newRef.id, tipo: 'Chip', numeroSerie: serie, modelo: '', status: 'Disponível', ativo: true, createdAt: new Date().toISOString() };
            pushOp(bch => bch.set(newRef, b));
            bordosByKey[`CHIP||${serie}`] = b;
            log.bordosCriados++;
        };

        if (temAlgumBordo) {
            if (!serieTelStr || !serieMagStr || !chipSerie) {
                log.avisos.push(`Frota <b>${frota}</b>: kit incompleto — Tela, Mag e Chip são obrigatórios juntos. Itens foram cadastrados sem vínculo.`);
                if (serieTelStr) criarOuBuscarBordo('Tela', serieTelStr, modeloTela);
                if (serieMagStr) criarOuBuscarBordo('Mag',  serieMagStr, modeloMag);
                if (chipSerie)   criarOuBuscarChip(chipSerie);
            } else {
                telaObj = criarOuBuscarBordo('Tela', serieTelStr, modeloTela);
                magObj  = criarOuBuscarBordo('Mag',  serieMagStr, modeloMag);
                chipObj = chipSerie ? (bordosByKey[`CHIP||${chipSerie}`] || null) : null;
                if (!chipObj && chipSerie) {
                    const newRef = doc(collection(db, colBordos));
                    chipObj = { id: newRef.id, tipo: 'Chip', numeroSerie: chipSerie, modelo: '', status: 'Disponível', ativo: true, createdAt: new Date().toISOString() };
                    pushOp(bch => bch.set(newRef, chipObj));
                    bordosByKey[`CHIP||${chipSerie}`] = chipObj;
                    log.bordosCriados++;
                }
                if (!telaObj || !magObj || !chipObj) {
                    telaObj = null; magObj = null; chipObj = null;
                }
            }
        }

        const temVinculo = radioObj || telaObj;
        if (!temVinculo) continue;

        let bloqueado = false;
        for (const item of [radioObj, telaObj, magObj, chipObj]) {
            if (!item || bloqueado) continue;
            if (item.status !== 'Disponível') {
                log.avisos.push(`Frota <b>${frota}</b>: ${item.tipo || 'Rádio'} <b>${item.serie || item.numeroSerie}</b> não está Disponível (${item.status}) — vínculo ignorado.`);
                bloqueado = true;
            }
        }
        if (bloqueado) continue;

        const codigoVinc = codigo || equipamento.codigo || equipamento.frota;
        const newRegRef = doc(collection(db, colRegistros));
        pushOp(b => b.set(newRegRef, {
            equipamentoId: equipamento.id, codigo: codigoVinc,
            radioId: radioObj?.id || null,
            telaId:  telaObj?.id  || null,
            magId:   magObj?.id   || null,
            chipId:  chipObj?.id  || null,
            createdAt: new Date().toISOString()
        }));

        if (radioObj) pushOp(b => b.update(doc(db, colRadios, radioObj.id), { status: 'Em Uso' }));
        if (telaObj)  pushOp(b => b.update(doc(db, colBordos, telaObj.id),  { status: 'Em Uso' }));
        if (magObj)   pushOp(b => b.update(doc(db, colBordos, magObj.id),   { status: 'Em Uso' }));
        if (chipObj)  pushOp(b => b.update(doc(db, colBordos, chipObj.id),  { status: 'Em Uso' }));

        equipsJaVinculados.add(equipamento.id);
        log.vinculos++;
    }

    if (opCount > 0) batches.push(currentBatch);

    const total = log.equipCriados + log.radiosCriados + log.bordosCriados + log.vinculos;
    if (total === 0 && log.avisos.length === 0) {
        showModal('Importação', 'Nenhuma linha válida encontrada no arquivo.', 'info');
        return;
    }

    try {
        const totalBatches = batches.length;
        for (let i = 0; i < totalBatches; i++) {
            const pct = 90 + Math.round(((i + 1) / totalBatches) * 10);
            updateImportProgress(
                `<p class="text-sm text-gray-600 dark:text-gray-300">Salvando no banco de dados... (${i + 1}/${totalBatches})</p>`,
                pct
            );
            await batches[i].commit();
        }
        await refreshDataFromFirestore();

        const resumo = [
            log.equipCriados  ? `<b>${log.equipCriados}</b> equipamento(s) criado(s)`   : '',
            log.radiosCriados ? `<b>${log.radiosCriados}</b> rádio(s) criado(s)`         : '',
            log.bordosCriados ? `<b>${log.bordosCriados}</b> bordo(s) criado(s)`         : '',
            log.vinculos      ? `<b>${log.vinculos}</b> vínculo(s) criado(s)`            : '',
        ].filter(Boolean).join('<br>') || 'Nenhuma alteração.';

        const avisosHtml = log.avisos.length
            ? `<div class="mt-3 text-xs text-yellow-700 dark:text-yellow-400 max-h-36 overflow-y-auto space-y-0.5 border border-yellow-300 dark:border-yellow-700 rounded p-2 bg-yellow-50 dark:bg-yellow-900/20">
                <p class="font-semibold mb-1">⚠ ${log.avisos.length} aviso(s):</p>
                ${log.avisos.map(a => `<p>• ${a}</p>`).join('')}
               </div>` : '';

        showModal('Importação Concluída', `${resumo}${avisosHtml}`, total > 0 ? 'success' : 'warning');
    } catch (error) {
        console.error('Erro ao importar:', error);
        showModal('Erro', 'Ocorreu um erro ao salvar os dados.', 'error');
    }
}


// 🌟 NOVO: Função central de verificação de duplicidades
function checkDuplicities() {
    const newDuplicities = [];

    // 1. Verificar Duplicidades de Rádios (Número de Série)
    const radioSeriesCount = {};
    dbRadios.forEach(r => {
        const serie = r.serie;
        if (serie) {
            if (!radioSeriesCount[serie]) {
                radioSeriesCount[serie] = [];
            }
            radioSeriesCount[serie].push(r);
        }
    });

    Object.values(radioSeriesCount).forEach(list => {
        if (list.length > 1) {
            list.forEach(r => {
                newDuplicities.push({
                    id: r.id,
                    type: 'Rádio',
                    field: 'Número de Série',
                    value: r.serie,
                    createdAt: r.createdAt,
                    collection: 'radios'
                });
            });
        }
    });

    // 2. Verificar Duplicidades de Equipamentos (Frota)
    const equipFrotaCount = {};
    dbEquipamentos.forEach(e => {
        const frota = e.frota;
        if (frota) {
            if (!equipFrotaCount[frota]) {
                equipFrotaCount[frota] = [];
            }
            equipFrotaCount[frota].push(e);
        }
    });

    Object.values(equipFrotaCount).forEach(list => {
        if (list.length > 1) {
            list.forEach(e => {
                newDuplicities.push({
                    id: e.id,
                    type: 'Equipamento',
                    field: 'Frota',
                    value: e.frota,
                    createdAt: e.createdAt,
                    collection: 'equipamentos'
                });
            });
        }
    });

    // 3. Verificar Duplicidades de Bordos (Tipo + Número de Série)
    const bordoSeriesCount = {};
    dbBordos.forEach(b => {
        // A chave de unicidade é Tipo + Série
        const key = `${b.tipo}-${b.numeroSerie}`;
        if (b.numeroSerie && b.tipo) {
            if (!bordoSeriesCount[key]) {
                bordoSeriesCount[key] = [];
            }
            bordoSeriesCount[key].push(b);
        }
    });

    Object.values(bordoSeriesCount).forEach(list => {
        if (list.length > 1) {
            list.forEach(b => {
                newDuplicities.push({
                    id: b.id,
                    type: `Bordo (${b.tipo})`,
                    field: 'Número de Série',
                    value: b.numeroSerie,
                    createdAt: b.createdAt,
                    collection: 'bordos'
                });
            });
        }
    });


    // Filtra duplicidades únicas e ordena por data de criação para melhor visualização
    duplicities = newDuplicities.filter((item, index, self) =>
        index === self.findIndex((t) => (t.id === item.id))
    ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); 
}


// --- Funções de Utilitário e Estado ---
function detachFirestoreListeners() {
    firestoreListeners.forEach(unsub => unsub());
    firestoreListeners = [];
    firestoreListenersAttached = false;
    if (firestoreRefreshInterval) {
        clearInterval(firestoreRefreshInterval);
        firestoreRefreshInterval = null;
    }
}

/**
 * NOVO: Verifica se o valor é um email ou um nome de usuário.
 */
function isEmail(value) {
    return value.includes('@') && value.includes('.');
}

/**
 * NOVO: Cria um email genérico para uso no Firebase Auth
 */
function createGenericEmail(customUsername, appId) {
    // Garante que o username é seguro para ser a parte local do email
    const safeUsername = customUsername.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${safeUsername}@${appId}.fake`;
}

async function loadInitialSettings() {
    if (!db || !appId) return;

    const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");
    try {
        // Tenta ler as configurações. A regra de segurança deve permitir a leitura para corrigir o erro inicial.
        const settingsSnap = await getDoc(settingsDocRef);
        if (settingsSnap.exists()) {
            const data = settingsSnap.data();
            settings.letterMap = data.letterMap || DEFAULT_LETTER_MAP;
            settings.nextIndex = data.nextIndex || DEFAULT_NEXT_INDEX;
            settings.users = data.users || []; 
        } else {
            console.warn("Documento de 'settings/config' não encontrado. Usando padrões locais.");
            // Define um usuário admin padrão se não houver configurações
            if (settings.users.length === 0) {
                settings.users = [{ 
                    id: crypto.randomUUID(), 
                    name: "Juliano Timoteo (Admin Padrão)", 
                    username: ADMIN_PRINCIPAL_EMAIL, 
                    role: "admin",
                    permissions: { dashboard: true, cadastro: true, pesquisa: true, settings: true }
                }];
            }
            // Tenta salvar, permitindo que a aplicação se configure se as regras permitirem.
            saveSettings();	
        }
    } catch (e) {
        // Loga o erro, mas a aplicação continua com os valores padrão de settings.users (a contingência no auth listener será usada).
        console.error("Erro ao carregar 'settings/config' na inicialização:", e);
    }
}

async function saveSettings() {
    if (!db || !appId) return;
    try {
        const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");
        await setDoc(settingsDocRef, {
            letterMap: settings.letterMap || {},
            nextIndex: settings.nextIndex || {},
            users: settings.users || [],
        });
    } catch (e) {
        console.error("Erro ao salvar settings:", e);
    }
}

function showProgressModal(title, message) {
    const modal = document.getElementById('global-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    modal.querySelector('div').classList.remove('max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl', 'max-w-4xl', 'max-w-5xl');
    modal.querySelector('div').classList.add('max-w-md');

    titleEl.textContent = title;
    titleEl.className = 'text-xl font-bold mb-3 text-blue-600 dark:text-blue-400';
    messageEl.innerHTML = message;
    actionsEl.innerHTML = '<div class="mt-4 w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700"><div id="import-progress-bar" class="bg-green-main h-2.5 rounded-full transition-all duration-300" style="width: 0%"></div></div>';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function updateImportProgress(message, percent) {
    const msgEl = document.getElementById('modal-message');
    const barEl = document.getElementById('import-progress-bar');
    if (msgEl && message !== undefined) msgEl.innerHTML = message;
    if (barEl) barEl.style.width = Math.min(100, Math.max(0, percent)) + '%';
}

let firestoreListenersAttached = false;
let firestoreRefreshInterval = null;

async function attachFirestoreListeners() {
    if (firestoreListenersAttached) return;
    if (!db || !appId || !currentUser) return;
    detachFirestoreListeners();
    firestoreListenersAttached = true;

    // 1. Carregar cache localStorage imediatamente para UI instantânea
    const cacheLoaded = loadDataCache();
    if (cacheLoaded && !isLoggingIn) renderApp();

    // 2. Buscar dados frescos do Firestore (getDocs, não onSnapshot)
    await refreshDataFromFirestore();

    // 3. Refresh automático a cada 2 horas
    if (firestoreRefreshInterval) clearInterval(firestoreRefreshInterval);
    firestoreRefreshInterval = setInterval(refreshDataFromFirestore, CACHE_DURATION);

    // 4. Listener para Solicitações Pendentes (Acesso: Apenas Admin) — mantém onSnapshot para tempo real
    if (currentUser.role === 'admin') {
        const pendingColPath = `artifacts/${appId}/public/data/pending_approvals`;
        const qPending = query(collection(db, pendingColPath));

        const unsubPending = onSnapshot(qPending, (querySnapshot) => {
            const data = [];
            querySnapshot.forEach((doc) => {
                data.push({ id: doc.id, ...doc.data() });
            });
            pendingUsers = data;
            if (!isLoggingIn) renderApp();
        }, (error) => {
            console.error(`Erro no listener de pending_approvals:`, error);
        });
        firestoreListeners.push(unsubPending);
    }
}

async function refreshDataFromFirestore() {
    if (!db || !appId) return;

    const collectionsToFetch = {
        'radios': (data) => dbRadios = data,
        'equipamentos': (data) => dbEquipamentos = data,
        'bordos': (data) => dbBordos = data,
        'registros': (data) => dbRegistros = data
    };

    try {
        const fetchPromises = Object.keys(collectionsToFetch).map(async (colName) => {
            const colPath = `artifacts/${appId}/public/data/${colName}`;
            const q = query(collection(db, colPath));
            const querySnapshot = await getDocs(q);
            const data = [];
            querySnapshot.forEach((doc) => {
                data.push({ id: doc.id, ...doc.data() });
            });
            collectionsToFetch[colName](data);
        });

        await Promise.all(fetchPromises);

        // 🌟 CORREÇÃO: A verificação de duplicidades precisa rodar toda vez que os
        // dados são atualizados (carga inicial, após salvar, após importar, a cada
        // refresh automático de 2h). Antes, `checkDuplicities()` só era chamada
        // dentro de `deleteDuplicity()`, ou seja, nunca era executada no fluxo normal
        // e o sino de integridade ficava sempre "verde" mesmo havendo duplicatas reais.
        checkDuplicities();

        saveDataCache();
        await saveDataCacheFile();

        if (!isLoggingIn) renderApp();
    } catch (error) {
        console.error('Erro ao atualizar dados do Firestore:', error);
    }
}

function updateState(key, value) {
    switch (key) {
        case 'page':
            if (value === 'login' && currentUser) return;
            if (value !== 'login' && !currentUser) {
                currentPage = 'login';
                window.location.hash = '#login';
                return;
            }
            currentPage = value;
            // 🌟 ATUALIZADO: Nova aba de bordos é o default, se houver
            currentCadastroTab = 'radio';
            currentSettingTab = 'system';
            // Reset da paginação
            radioPage = 1; equipamentoPage = 1, bordosPage = 1, geralPage = 1, pesquisaPage = 1; 
            // Reset da busca
            radioSearch = '', equipamentoSearch = '', bordosSearch = '', geralSearch = '', searchTermPesquisa = ''; 
            focusedSearchInputId = null;	
            // 🌟 REMOVIDO: pendingEquipamentoId e vinculoTipo não são mais necessários
            break;
        case 'loginView':
            currentLoginView = value;
            break;
        case 'cadastroTab':
            currentCadastroTab = value;
            focusedSearchInputId = null;
            // 🌟 REMOVIDO: Limpeza de pendingEquipamentoId e vinculoTipo
            break;
        case 'settingTab':
            currentSettingTab = value;
            focusedSearchInputId = null;
            break;
        case 'settings':	
            settings = value;
            break;
        // 🌟 REMOVIDO: case 'pendingEquipamentoId'
    }
    
    let hash = `#${currentPage}`;
    if (currentPage === 'cadastro') hash = `#${currentPage}/${currentCadastroTab}`;
    else if (currentPage === 'settings') hash = `#${currentPage}/${currentSettingTab}`;
    
    if (window.location.hash.substring(1) !== hash.substring(1)) {
        window.location.hash = hash;
    } else {
        renderApp();	
    }
}

// --- Funções de Paginação (NOVA CORREÇÃO) ---
function setRadioPage(delta) {
    radioPage = Math.max(1, radioPage + delta);
    renderApp();
}
function setEquipamentoPage(delta) {
    equipamentoPage = Math.max(1, equipamentoPage + delta);
    renderApp();
}
// 🌟 NOVO: Paginação para a aba Bordos
function setBordosPage(delta) {
    bordosPage = Math.max(1, bordosPage + delta);
    renderApp();
}
function setGeralPage(delta) {
    geralPage = Math.max(1, geralPage + delta);
    renderApp();
}
// 🌟 NOVO: Paginação para a aba Pesquisa
function setPesquisaPage(delta) {
    pesquisaPage = Math.max(1, pesquisaPage + delta);
    renderApp();
}

function abrirRelatorio(recordId) {
    const record = dbRegistros.find(r => r.id === recordId);
    if (!record) return;
    const e = dbEquipamentos.find(item => item.id === record.equipamentoId) || {};
    const r = dbRadios.find(item => item.id === record.radioId) || {};
    const t = dbBordos.find(item => item.id === record.telaId && item.tipo === 'Tela') || {};
    const m = dbBordos.find(item => item.id === record.magId && item.tipo === 'Mag') || {};
    const c = dbBordos.find(item => item.id === record.chipId && item.tipo === 'Chip') || {};
    pesquisaReport = { id: record.id, equipamento: e, radio: r, tela: t, mag: m, chip: c };
    renderApp();
}

function fecharRelatorio() {
    pesquisaReport = null;
    renderApp();
}

async function exportarCadastroJSON() {
    const data = {
        exportadoEm: new Date().toISOString(),
        registros: dbRegistros,
        equipamentos: dbEquipamentos,
        radios: dbRadios,
        bordos: dbBordos
    };
    const json = JSON.stringify(data, null, 2);

    // Tenta salvar via OPFS primeiro (silencioso)
    try {
        const root = await navigator.storage.getDirectory();
        const fileHandle = await root.getFileHandle('cadastro.json', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
        showModal('Exportado', 'cadastro.json atualizado no armazenamento local do app.', 'success');
        return;
    } catch (e) {
        console.warn('OPFS indisponível, usando download:', e);
    }

    // Fallback: download tradicional
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cadastro_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showRadioAmadorModal() {
    const modal = document.createElement('div');
    modal.id = 'radio-amador-modal';
    modal.innerHTML = `
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onclick="if(event.target===this)fecharRadioAmadorModal()">
            <div class="w-full max-w-md bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1a] rounded-2xl p-6 shadow-2xl border border-green-900/40" style="box-shadow: 0 0 40px rgba(0,255,65,0.05), inset 0 0 40px rgba(0,255,65,0.03);" onclick="event.stopPropagation()">
                <div class="text-center mb-4">
                    <div class="text-green-500/40 text-xs tracking-[0.3em] uppercase mb-1">Link-Frota</div>
                    <div class="text-green-400/60 text-[10px] tracking-[0.5em] uppercase">Radio Amador</div>
                </div>
                <div class="bg-[#050508] rounded-lg p-4 mb-4 border border-green-900/30 font-mono" style="box-shadow: inset 0 0 20px rgba(0,0,0,0.8), 0 0 10px rgba(0,255,65,0.03);">
                    <div class="flex items-center justify-between mb-3">
                        <span class="text-green-500/50 text-[10px] tracking-wider">RX/TX</span>
                        <span class="text-green-500/30 text-[10px]">
                            <span class="inline-block w-2 h-2 rounded-full bg-green-500/40 animate-pulse mr-1"></span>
                            ONLINE
                        </span>
                    </div>
                    <div class="text-center mb-3">
                        <div class="text-4xl tracking-[0.15em] text-green-400 font-mono font-bold drop-shadow-[0_0_10px_rgba(0,255,65,0.3)]" id="radio-modal-freq">---</div>
                        <div class="text-[10px] text-green-600/50 tracking-[0.3em] mt-1">MHz</div>
                    </div>
                    <div class="border-t border-green-900/30 pt-3" id="radio-modal-dados">
                        <div class="text-green-700/50 text-xs text-center py-4">AGUARDANDO CÓDIGO</div>
                    </div>
                    <div class="border-t border-green-900/30 pt-3 mt-3" id="radio-modal-sinal" style="display:none">
                        <div class="text-[10px] text-green-600/50 mb-2">SINAL</div>
                        <div class="flex items-center gap-1">
                            ${[1,2,3,4,5].map(i => `<div class="h-3 flex-1 rounded-sm bg-green-500/60" style="box-shadow: 0 0 6px rgba(0,255,65,0.4)"></div>`).join('')}
                        </div>
                    </div>
                </div>
                <input type="text" id="radio-modal-input" placeholder="DIGITE O CÓDIGO" maxlength="10" class="w-full bg-[#050508] border border-green-900/40 rounded-lg px-4 py-3 mb-3 text-green-400 font-mono text-lg tracking-widest text-center placeholder-green-800/40 focus:outline-none focus:border-green-600/60 focus:ring-1 focus:ring-green-600/30 uppercase" autocomplete="off" />
                <div class="grid grid-cols-3 gap-2">
                    <button onclick="radioModalBuscar()" class="col-span-2 bg-green-900/30 hover:bg-green-800/40 text-green-400 border border-green-700/40 rounded-lg py-3 font-mono text-sm tracking-wider transition-all active:scale-95">
                        <i class="fas fa-search mr-2"></i> PESQUISAR
                    </button>
                    <button onclick="fecharRadioAmadorModal()" class="bg-red-900/20 hover:bg-red-800/30 text-red-400 border border-red-700/30 rounded-lg py-3 font-mono text-sm tracking-wider transition-all active:scale-95">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    setTimeout(() => {
        const input = document.getElementById('radio-modal-input');
        if (input) {
            input.focus();
            input.onkeydown = (e) => { if (e.key === 'Enter') radioModalBuscar(); };
        }
    }, 100);
}

function fecharRadioAmadorModal() {
    const modal = document.getElementById('radio-amador-modal');
    if (modal) modal.remove();
}

function radioModalBuscar() {
    const input = document.getElementById('radio-modal-input');
    const freq = document.getElementById('radio-modal-freq');
    const dados = document.getElementById('radio-modal-dados');
    const sinal = document.getElementById('radio-modal-sinal');
    if (!input || !freq || !dados) return;

    const code = input.value.trim().toUpperCase();
    freq.textContent = code || '---';

    if (!code) {
        dados.innerHTML = '<div class="text-green-700/50 text-xs text-center py-4">AGUARDANDO CÓDIGO</div>';
        sinal.style.display = 'none';
        return;
    }

    let found = null;
    for (const reg of dbRegistros) {
        const e = dbEquipamentos.find(item => item.id === reg.equipamentoId) || {};
        const r = dbRadios.find(item => item.id === reg.radioId) || {};
        const t = dbBordos.find(item => item.id === reg.telaId && item.tipo === 'Tela') || {};
        const m = dbBordos.find(item => item.id === reg.magId && item.tipo === 'Mag') || {};
        const c = dbBordos.find(item => item.id === reg.chipId && item.tipo === 'Chip') || {};
        const codigo = (e.codigo || '').toUpperCase();
        const frota = (e.frota || '').toUpperCase();
        const serieRadio = (r.serie || '').toUpperCase();
        if (`${codigo} ${frota} ${serieRadio}`.includes(code)) {
            const bs = [t.numeroSerie, m.numeroSerie, c.numeroSerie].filter(Boolean);
            found = {
                codigo: e.codigo || 'N/A',
                frota: e.frota || 'N/A',
                grupo: e.grupo || 'N/A',
                gestor: e.gestor || 'Sem Gestor',
                serieRadio: r.serie || 'N/A',
                serieBordos: bs.length ? bs.join(' / ') : 'N/A',
            };
            break;
        }
    }

    if (found) {
        dados.innerHTML = `
            <div class="space-y-1 text-xs leading-tight">
                <div class="flex justify-between"><span class="text-green-400/70">COD:</span><span class="text-amber-300 font-mono font-bold">${found.codigo}</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">FROTA:</span><span class="text-white font-mono">${found.frota}</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">GRUPO:</span><span class="text-white font-mono">${found.grupo}</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">GESTOR:</span><span class="text-white font-mono">${found.gestor}</span></div>
                <div class="flex justify-between border-t border-green-800/50 pt-1 mt-1"><span class="text-green-400/70">RADIO:</span><span class="text-cyan-300 font-mono">${found.serieRadio}</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">BORDOS:</span><span class="text-cyan-300 font-mono truncate max-w-[180px]">${found.serieBordos}</span></div>
            </div>
        `;
        sinal.style.display = 'block';
    } else {
        dados.innerHTML = `
            <div class="space-y-1 text-xs leading-tight">
                <div class="flex justify-between"><span class="text-green-400/70">COD:</span><span class="text-red-400 font-mono font-bold">---</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">FROTA:</span><span class="text-red-400/70 font-mono">NÃO ENCONTRADO</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">GRUPO:</span><span class="text-gray-600 font-mono">---</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">GESTOR:</span><span class="text-gray-600 font-mono">---</span></div>
                <div class="flex justify-between border-t border-green-800/50 pt-1 mt-1"><span class="text-green-400/70">RADIO:</span><span class="text-gray-600 font-mono">---</span></div>
                <div class="flex justify-between"><span class="text-green-400/70">BORDOS:</span><span class="text-gray-600 font-mono">---</span></div>
            </div>
        `;
        sinal.style.display = 'none';
    }
}

// --- Funções de Geração de Código ---

function zpad(n, size) {	
    return String(n).padStart(size, '0');	
}

function generateCode(group) {
    const letterMap = settings.letterMap;
    const nextIndex = settings.nextIndex;
    const letter = letterMap[group];
    
    if (!letter) {
        showModal('Erro', `Mapeamento de letra não encontrado para o grupo: ${group}`, 'error');
        return null;
    }

    const indexKey = letter === 'NUM' ? 'NUM' : letter;
    let index = nextIndex[indexKey] || 1;	
    let code;

    if (letter === 'NUM') code = zpad(index, 3);
    else code = letter + zpad(index, 3);
    
    // **CORREÇÃO CRÍTICA**: O próximo índice DEVE ser salvo em um clone do objeto nextIndex
    const newNextIndex = { ...nextIndex };
    newNextIndex[indexKey] = index + 1;
    settings.nextIndex = newNextIndex;	
    
    saveSettings();	

    return code;
}

// --- Funções de CRUD ---

/**
 * @CORREÇÃO CRÍTICA: Validação de vínculo obrigatório
 * Não é possível salvar Rádio ou Bordo sem Frota.
 * Esta função agora é um guard-rail para o saveRecord.
 */
async function validateVinculoBeforeSave(data) {
    // Regra: Não pode haver registros de Rádio ou Bordo sem Frota.
    // Esta validação se aplica apenas a registros novos de associação.
    if (data.equipamentoId) {
        return true; 
    }
    
    // Se não há EquipamentoId, e estamos em uma coleção que não é a de Registros, tudo bem.
    if (data.collection !== 'registros') return true; 

    // Se estamos em 'registros', e não há Frota.
    if (!data.equipamentoId) {
        showModal('Erro de Vínculo', 'O vínculo de Rádio ou Bordo **deve** ser feito a uma Frota (Equipamento).', 'error');
        return false;
    }

    return true;
}

/**
 * @STEP 1: Refresh automático após salvar/atualizar
 * Dispara refreshDataFromFirestore() para buscar dados atualizados do Firestore
 */
async function saveRecord(collectionName, record) {
    if (!db || !appId) {
        showModal('Erro', 'Conexão com o banco de dados perdida.', 'error');
        return;
    }
    
    // [CORREÇÃO] Usa appId hardcoded
    const colPath = `artifacts/${appId}/public/data/${collectionName}`;
    let recordData = { ...record };	

    // @STEP 2: Adiciona a validação de vínculo antes de salvar
    if (collectionName === 'registros') {
        // CORREÇÃO: A validação mais profunda de 'registro novo com rádio ou bordos' foi movida para o modal de vínculo.
        // Aqui mantemos apenas o guard-rail contra registros órfãos.
        const isValid = await validateVinculoBeforeSave({ ...recordData, collection: collectionName });
        if (!isValid) return;
    }
    // Fim da @STEP 2

    try {
        if (recordData.id) {
            // Update
            const docRef = doc(db, colPath, recordData.id);
            delete recordData.id;	
            await setDoc(docRef, recordData, { merge: true });
            showModal('Sucesso', `${collectionName} atualizado com sucesso!`, 'success');
        } else {
            // Create
            recordData.createdAt = new Date().toISOString();
            if (collectionName === 'radios' || collectionName === 'equipamentos' || collectionName === 'bordos') {
                recordData.ativo = true;
            }
            if (collectionName === 'radios') {
                recordData.status = recordData.status || 'Disponível';
            }
            if (collectionName === 'bordos') {
                 // 🌟 NOVO: Status padrão para itens de bordo
                recordData.status = recordData.status || 'Disponível'; 
            }
            delete recordData.id;	
            await addDoc(collection(db, colPath), recordData);
            showModal('Sucesso', `${collectionName} adicionado com sucesso!`, 'success');
        }
        
        await refreshDataFromFirestore();
    } catch (error) {
        console.error(`Erro ao salvar registro de ${collectionName}:`, error);
        showModal('Erro', 'Não foi possível salvar o registro no banco de dados.', 'error');
    }
}

/**
 * NOVO: Função central para desvincular itens de um registro geral.
 * @param {string} regId ID do registro geral (registros).
 * @param {'radio'|'bordos'} type Tipo de desvinculação a ser realizada.
 */
async function deleteLink(regId, type) {
    if (!db || !appId || type === 'registros') {
        showModal('Erro', 'Ação inválida de desvinculação.', 'error');
        return;
    }

    const regRef = doc(db, `artifacts/${appId}/public/data/registros`, regId);
    const regSnap = await getDoc(regRef);	

    if (!regSnap.exists()) {
        showModal('Erro', 'Registro de associação não encontrado.', 'error');
        return;
    }

    const registroAtual = regSnap.data();
    const batch = writeBatch(db);
    let successMessage = '';
    
    try {
        if (type === 'radio') {
            // Desvincular Rádio (e Equipamento)
            
            // 1. Atualiza o status do Rádio para "Disponível"
            if (registroAtual.radioId) {
                const radioRef = doc(db, `artifacts/${appId}/public/data/radios`, registroAtual.radioId);
                batch.update(radioRef, { status: 'Disponível' });
            }

            // 2. Remove o radioId e o Código do registro principal
            
            // Se houver bordos vinculados, apenas nullifica o radio/equipamento e o código
            if (registroAtual.telaId || registroAtual.magId || registroAtual.chipId) {
                // Atualiza o registro, removendo apenas as referências ao rádio.
                // O código NUNCA é removido — é permanente e acompanha o equipamento para sempre.
                batch.update(regRef, {
                    radioId: null
                });
                successMessage = 'Rádio desvinculado com sucesso! Os Bordos permanecem vinculados à Frota.';
            } else {
                // Se não houver bordos, o registro de associação é deletado completamente.
                batch.delete(regRef);
                successMessage = 'Rádio desvinculado e registro de associação removido com sucesso!';
            }

        } else if (type === 'bordos') {
            // Desvincular Bordos (Tela, Mag, Chip)

            // 1. Atualiza o status de cada Bordo para "Disponível"
            if (registroAtual.telaId) {
                const telaRef = doc(db, `artifacts/${appId}/public/data/bordos`, registroAtual.telaId);
                batch.update(telaRef, { status: 'Disponível' });
            }
            if (registroAtual.magId) {
                const magRef = doc(db, `artifacts/${appId}/public/data/bordos`, registroAtual.magId);
                batch.update(magRef, { status: 'Disponível' });
            }
            if (registroAtual.chipId) {
                const chipRef = doc(db, `artifacts/${appId}/public/data/bordos`, registroAtual.chipId);
                batch.update(chipRef, { status: 'Disponível' });
            }

            // 2. Nullifica as IDs dos bordos no registro principal
            
            // Se houver rádio/equipamento, o registro é atualizado, mas não deletado
            if (registroAtual.radioId) {
                // Se o rádio estiver presente, apenas nullifica os bordos
                batch.update(regRef, {
                    telaId: null,
                    magId: null,
                    chipId: null
                });
                successMessage = 'Itens de Bordo desvinculados com sucesso! O Rádio e Frota permanecem vinculados.';
            } else {
                // Se o rádio já não estiver presente, deleta o registro (sob a premissa de que a única coisa restante eram os bordos)
                batch.delete(regRef);
                successMessage = 'Itens de Bordo desvinculados e registro removido com sucesso! (Frota agora livre)';
            }

        } else {
             showModal('Erro', 'Tipo de desvinculação não reconhecido.', 'error');
             return;
        }

        await batch.commit();
        showModal('Sucesso', successMessage, 'success');

        await refreshDataFromFirestore();

    } catch (error) {
        console.error("Erro ao desvincular registro:", error);
        showModal('Erro', 'Ocorreu um erro durante a operação de desvinculação.', 'error');
    }
}


/**
 * 🌟 CORREÇÃO: Desvinculação automática ao marcar item como "Sinistro".
 *
 * Regra de negócio: "Sinistro" significa que o item foi perdido/queimado/roubado
 * e não pode mais permanecer fisicamente vinculado a uma Frota. Antes desta
 * correção, o formulário de edição BLOQUEAVA a troca de status de um item
 * "Em Uso" para qualquer outro valor (revertendo silenciosamente para "Em Uso"
 * de volta e pedindo para desvincular manualmente na aba "Geral"). Isso incluía
 * o caso de Sinistro, deixando o item preso ao equipamento mesmo estando
 * inutilizável.
 *
 * Esta função localiza o registro de vínculo (`registros`) que referencia o
 * item (rádio ou bordo) e remove apenas a referência a ESSE item específico.
 * Se, após a remoção, o registro não referenciar mais nenhum item (rádio nem
 * bordos), o registro de associação é removido por completo (frota liberada).
 *
 * @param {'radios'|'bordos'} collectionName Coleção do item marcado como Sinistro.
 * @param {string} itemId ID do documento do rádio ou bordo.
 */
async function autoUnlinkOnSinistro(collectionName, itemId) {
    if (!db || !appId) return;

    let registro = null;
    if (collectionName === 'radios') {
        registro = dbRegistros.find(reg => reg.radioId === itemId);
    } else if (collectionName === 'bordos') {
        registro = dbRegistros.find(reg =>
            reg.telaId === itemId || reg.magId === itemId || reg.chipId === itemId
        );
    }

    // Item não está vinculado a nenhuma Frota — nada a fazer.
    if (!registro) return;

    const regRef = doc(db, `artifacts/${appId}/public/data/registros`, registro.id);
    const updates = {};

    if (collectionName === 'radios') {
        updates.radioId = null;
    } else {
        if (registro.telaId === itemId) updates.telaId = null;
        if (registro.magId === itemId) updates.magId = null;
        if (registro.chipId === itemId) updates.chipId = null;
    }

    // Estado resultante do registro após remover apenas a referência ao item em Sinistro
    const resultante = { ...registro, ...updates };
    const semNadaVinculado = !resultante.radioId && !resultante.telaId && !resultante.magId && !resultante.chipId;

    try {
        if (semNadaVinculado) {
            await deleteDoc(regRef);
        } else {
            await updateDoc(regRef, updates);
        }
    } catch (error) {
        console.error('Erro ao desvincular automaticamente item em Sinistro:', error);
        showModal('Erro', 'O item foi salvo como Sinistro, mas houve uma falha ao desvincular automaticamente da Frota. Verifique e desvincule manualmente na aba "Geral".', 'error');
    }
}

/**
 * @NOVA IMPLEMENTAÇÃO: Abre modal para vincular Rádio ou Bordos à Frota
 * * [CORREÇÃO APLICADA]: Adicionado scroll interno para corrigir visualização mobile.
 * * @param {string} equipamentoId ID da Frota a ser vinculada.
 * @param {'radio'|'bordos'} tipo Tipo de componente a ser vinculado.
 */
function showVincularModal(equipamentoId, tipo) {
    const equipamento = dbEquipamentos.find(e => e.id === equipamentoId);
    if (!equipamento) {
        showModal('Erro', 'Frota não encontrada.', 'error');
        return;
    }
    
    // Encontra o registro de vínculo existente
    const registro = dbRegistros.find(reg => reg.equipamentoId === equipamentoId);
    
    // Filtra e mapeia ITENS DISPONÍVEIS para substituição/adição
    const availableRadios = dbRadios.filter(r =>    
        r.ativo !== false &&    
        r.status === 'Disponível' &&    
        !dbRegistros.some(reg => reg.radioId === r.id)
    );
    // Bordos disponíveis: aqueles ativos E com status 'Disponível' E não vinculados a outro registro.
    const availableBordos = dbBordos.filter(b => 
        b.ativo !== false &&
        b.status === 'Disponível' &&
        !dbRegistros.some(reg => reg.telaId === b.id || reg.magId === b.id || reg.chipId === b.id)
    );

    const bordosPorTipo = availableBordos.reduce((acc, b) => {
        acc[b.tipo] = acc[b.tipo] || [];
        acc[b.tipo].push(b);
        return acc;
    }, {});
    
    // Mapeamento de itens ATUALMENTE VINCULADOS
    const bordoMap = dbBordos.reduce((acc, b) => { acc[b.id] = b; return acc; }, {});
    const linkedBordos = {
        Tela: registro && registro.telaId ? bordoMap[registro.telaId] : null,
        Mag: registro && registro.magId ? bordoMap[registro.magId] : null,
        Chip: registro && registro.chipId ? bordoMap[registro.chipId] : null,
    };
    const linkedRadio = registro && registro.radioId ? dbRadios.find(r => r.id === registro.radioId) : null;


    const radioOptions = availableRadios
        .map(r => `<option value="${r.id}">${r.serie} (${r.modelo})</option>`)
        .join('');
    
    // 🌟 CORREÇÃO: Antes, a opção "Manter Atual / Desvincular" era um ÚNICO item de
    // menu que, na prática, sempre se comportava como "manter" — nunca desvinculava
    // de verdade (o handler só processava a troca quando um item concreto era
    // escolhido). Isso impedia liberar um item (ex: para poder marcá-lo como
    // Sinistro depois) sem escolher um substituto na hora. Agora são duas opções
    // reais e distintas: __KEEP__ (não mexe em nada) e __UNLINK__ (desvincula de
    // fato, sem exigir substituto).
    const getBordoOptions = (tipo) => {
        const linkedItem = linkedBordos[tipo];
        let options = '';
        
        if (linkedItem) {
            options += `<option value="__KEEP__" selected>Manter ${tipo} Atual (não alterar)</option>`;
            options += `<option value="__UNLINK__">🔓 Desvincular ${tipo} (sem substituir)</option>`;
        } else {
             options += `<option value="" selected>Selecione o ${tipo}</option>`;
        }

        // 2. Adiciona itens disponíveis
        const bordos = bordosPorTipo[tipo] || [];
        options += bordos.map(b => `<option value="${b.id}">${b.numeroSerie} (${b.modelo})</option>`).join('');
        
        return options;
    };

    const isRadioMode = tipo === 'radio';
    const isBordosMode = tipo === 'bordos';
    
    let infoHtml = '';
    let formHtml = '';
    let isEditingMode = !!registro; 

    if (isRadioMode) {
        if (linkedRadio && !isEditingMode) {
            infoHtml = '<p class="text-red-500 font-semibold">Erro: Um Rádio já está vinculado a esta Frota. Use a aba Geral para gerenciar.</p>';
        } else {
            const currentRadioDisplay = linkedRadio ? linkedRadio.serie + ' (' + linkedRadio.modelo + ')' : 'NENHUM RÁDIO VINCULADO';
            
            infoHtml = `<p class="text-gray-700 dark:text-gray-300"><b>Rádio Atual:</b> ${currentRadioDisplay}</p><p class="mt-2 text-sm text-yellow-600 dark:text-yellow-400">Selecione um Rádio abaixo para VINCULAR, SUBSTITUIR ou escolha "Desvincular" para liberar sem colocar outro no lugar.</p>`;
            
            formHtml = `
                <div>
                    <label for="modal-radio-id" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Rádio (Seleção/Substituição)</label>
                    <select id="modal-radio-id" class="tom-select-radio-modal mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                        ${linkedRadio
                            ? `<option value="__KEEP__" selected>Manter Rádio Atual (não alterar)</option>
                               <option value="__UNLINK__">🔓 Desvincular Rádio (sem substituir)</option>`
                            : `<option value="">Selecione o Rádio para vincular...</option>`
                        }
                        ${radioOptions}
                    </select>
                </div>
            `;
        }
    } else if (isBordosMode) {
        infoHtml = `<p class="text-gray-700 dark:text-gray-300">Gerencie a Tela, Mag e Chip. Para substituir ou desvincular uma peça, selecione a opção desejada no menu e clique em **"Atualizar Vínculos"**.</p>`;
        
        const renderBordoBlock = (tipo) => {
            const typeLower = tipo.toLowerCase();
            const linkedItem = linkedBordos[tipo];
            const currentSerie = linkedItem ? `${linkedItem.numeroSerie} (${linkedItem.modelo})` : 'NENHUM';
            
            return `
                <div class="border p-3 rounded-lg dark:border-gray-600">
                    <p class="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">${tipo} Atual: <span class="font-mono text-indigo-600 dark:text-indigo-400">${currentSerie}</span></p>
                    
                    <div>
                        <label for="modal-${typeLower}-id" class="block text-xs font-medium text-gray-700 dark:text-gray-300">${linkedItem ? 'Substituir ou Desvincular:' : 'Vincular novo item:'}</label>
                        <select id="modal-${typeLower}-id" 
                                class="tom-select-bordo-modal mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            ${getBordoOptions(tipo)}
                        </select>
                         <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Escolha "Desvincular" para liberar o item sem colocar outro no lugar, ou selecione um item para vincular/substituir.</p>
                    </div>
                </div>
            `;
        }
        
        formHtml = `
            <div class="space-y-4">
                ${renderBordoBlock('Tela')}
                ${renderBordoBlock('Mag')}
                ${renderBordoBlock('Chip')}
            </div>
        `;
    } else {
        showModal('Erro', 'Tipo de vínculo desconhecido.', 'error');
        return;
    }
    
    // Monta o conteúdo do modal
    const modal = document.getElementById('global-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    modal.querySelector('div').classList.remove('max-w-sm', 'max-w-md', 'max-w-lg');
    modal.querySelector('div').classList.add('max-w-xl'); 

    const modalTitle = isEditingMode 
        ? `Gerenciar Vínculos da Frota ${equipamento.frota} (Cód: ${equipamento.codigo || 'N/A'})`
        : `Novo Vínculo à Frota ${equipamento.frota}`;
        
    titleEl.textContent = modalTitle;
    titleEl.className = `text-xl font-bold mb-3 text-green-main dark:text-green-400`;
    
    // 🌟 CORREÇÃO AQUI: Adicionado 'max-h-[60vh] overflow-y-auto' para scroll no mobile
    messageEl.innerHTML = `
        <div class="max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
            <div class="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg shadow-inner border dark:border-gray-700 space-y-3 mb-4">
                <p class="font-semibold text-gray-800 dark:text-gray-100">Informações da Frota:</p>
                <p class="text-sm text-gray-700 dark:text-gray-300"><span class="font-semibold">Grupo:</span> ${equipamento.grupo}</p>
                <p class="text-sm text-gray-700 dark:text-gray-300"><span class="font-semibold">Modelo:</span> ${equipamento.modelo}</p>
                <p class="text-sm text-gray-700 dark:text-gray-300"><span class="font-semibold">Código Atual:</span> ${equipamento.codigo || 'N/A'}</p>
            </div>
            <div class="mt-4">
                ${infoHtml}
                <form id="form-vincular-modal" class="mt-4 space-y-4">
                    ${formHtml}
                </form>
            </div>
        </div>
    `;

    // Botões de ação do modal
    actionsEl.innerHTML = `
        <button onclick="hideVincularModal()" class="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors shadow-md">
            Fechar
        </button>
        <button id="confirm-vincular-btn" class="px-3 py-1.5 text-sm bg-green-main text-white font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-md">
            <i class="fas fa-link mr-2"></i> ${isEditingMode ? 'Atualizar Vínculos' : 'Confirmar Novo Vínculo'}
        </button>
    `;
    
    // Exibe o modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Inicializa TomSelects
    const initTomSelectInstance = (el) => {
        if (el) {
            new TomSelect(el, {
                plugins: ['dropdown_input'],
                maxItems: 1,
                allowEmptyOption: true,
                placeholder: 'Selecione ou deixe vazio...',
            });
        }
    };
    
    initTomSelectInstance(document.getElementById('modal-radio-id'));
    initTomSelectInstance(document.getElementById('modal-tela-id'));
    initTomSelectInstance(document.getElementById('modal-mag-id'));
    initTomSelectInstance(document.getElementById('modal-chip-id'));
    
    const confirmBtn = document.getElementById('confirm-vincular-btn');
    if (confirmBtn) {
        confirmBtn.onclick = () => handleVincularSubmit(equipamentoId, tipo, registro);
    }
}
// --- CORREÇÃO: Independência entre "Vincular Rádio" e "Vincular Bordo" ---
function corrigirVinculosIndependentes() {
  const btnVincRadio = document.getElementById('btnVincRadio');
  const btnVincBordo = document.getElementById('btnVincBordo');
  if (!btnVincRadio || !btnVincBordo) return;

  // Remove listeners antigos
  btnVincRadio.replaceWith(btnVincRadio.cloneNode(true));
  btnVincBordo.replaceWith(btnVincBordo.cloneNode(true));

  const novoBtnVincRadio = document.getElementById('btnVincRadio');
  const novoBtnVincBordo = document.getElementById('btnVincBordo');

  novoBtnVincRadio.addEventListener('click', (e) => {
    e.stopPropagation();
    novoBtnVincRadio.classList.toggle('ativo');
    // grava estado
    localStorage.setItem('vincRadioAtivo', novoBtnVincRadio.classList.contains('ativo'));
  });

  novoBtnVincBordo.addEventListener('click', (e) => {
    e.stopPropagation();
    novoBtnVincBordo.classList.toggle('ativo');
    // grava estado
    localStorage.setItem('vincBordoAtivo', novoBtnVincBordo.classList.contains('ativo'));
  });

  // restaura estado salvo
  if (localStorage.getItem('vincRadioAtivo') === 'true') novoBtnVincRadio.classList.add('ativo');
  if (localStorage.getItem('vincBordoAtivo') === 'true') novoBtnVincBordo.classList.add('ativo');
}
setTimeout(corrigirVinculosIndependentes, 300);



// Executar após renderização
document.addEventListener('DOMContentLoaded', corrigirVinculosIndependentes);


/**
 * NOVO: Função para desvincular um item de bordo individualmente.
 * (REMOVIDA a função, pois a lógica foi consolidada no handleVincularSubmit
 * O botão Desvincular individual agora apenas define o valor como nulo e chama o submit principal)
 */
// async function handleDesvincularBordoIndividual(...) { ... }


function hideVincularModal() {
    hideModal();
    // Retorna o modal ao tamanho padrão
    document.getElementById('global-modal').querySelector('div').classList.remove('max-w-md', 'max-w-xl', 'max-w-lg');
    document.getElementById('global-modal').querySelector('div').classList.add('max-w-sm');
}

/**
 * @NOVA IMPLEMENTAÇÃO: Lógica de submissão do formulário de Vínculo no Modal.
 */
// Substitua a função handleVincularSubmit existente por esta versão.
async function handleVincularSubmit(equipamentoId, tipo, existingReg) {
  const isEditingMode = !!existingReg;

  // selects do modal (podem ser null se não existirem no modal atual)
  const radioSelect = document.getElementById('modal-radio-id');
  const telaSelect  = document.getElementById('modal-tela-id');
  const magSelect   = document.getElementById('modal-mag-id');
  const chipSelect  = document.getElementById('modal-chip-id');

  // 🌟 CORREÇÃO: antes, o valor "" do select era usado tanto para "não fiz nada,
  // mantenha como está" quanto teria que representar "desvincular sem substituir",
  // e isso nunca funcionava (ver comentário em getBordoOptions). Agora os selects
  // emitem sentinelas explícitas: '__KEEP__' (não mexe em nada) e '__UNLINK__'
  // (desvincula de fato, sem exigir um item substituto).
  const NOCHANGE = '__NOCHANGE__';
  const interpretSelectValue = (select, existingId) => {
    if (!select) return NOCHANGE;
    const val = select.value;
    if (val === '__KEEP__') return NOCHANGE;
    if (val === '__UNLINK__') return null; // desvincular de verdade, sem substituto
    if (val === '') return existingId ? NOCHANGE : null; // fallback: nenhum item vinculado e nada escolhido
    return val; // um item real foi escolhido (vínculo novo ou substituição)
  };

  const radioIdNew = interpretSelectValue(radioSelect, null);
  const telaIdNew  = interpretSelectValue(telaSelect, null);
  const magIdNew   = interpretSelectValue(magSelect, null);
  const chipIdNew  = interpretSelectValue(chipSelect, null);

  // valores existentes (se houver)
  const radioIdExisting = existingReg ? existingReg.radioId : null;
  const telaIdExisting  = existingReg ? existingReg.telaId  : null;
  const magIdExisting   = existingReg ? existingReg.magId   : null;
  const chipIdExisting  = existingReg ? existingReg.chipId  : null;

  // guarda os valores finais (inicializados com existentes)
  let radioToUse = radioIdExisting;
  let telaToUse  = telaIdExisting;
  let magToUse   = magIdExisting;
  let chipToUse  = chipIdExisting;

  if (!equipamentoId) {
    showModal('Erro', 'A Frota (Equipamento) é obrigatória para qualquer vínculo.', 'error');
    return;
  }

  // Regras por modo:
  // - Se tipo === 'radio' : só mexer em rádio. Não tocar em bordos.
  // - Se tipo === 'bordos' : só mexar em bordos. Não tocar em rádio.
  // - Se for criação (não isEditingMode) e tipo === 'radio' aceitamos só rádio.
  // - Se for criação e tipo === 'bordos' exigimos kit completo (3 itens).

  if (!isEditingMode) {
    if (tipo === 'bordos') {
      const bordosSelecionados = [telaIdNew, magIdNew, chipIdNew].filter(Boolean).length;
      if (bordosSelecionados === 0 && !radioIdNew) {
        showModal('Erro', 'Para criar um novo registro, selecione um Rádio ou o Kit de Bordos (3 itens).', 'error');
        return;
      }
      if (bordosSelecionados > 0 && bordosSelecionados < 3) {
        showModal('Erro de Bordo', 'Vínculo de Bordos exige Tela, Mag e Chip (kit completo).', 'error');
        return;
      }
    }

    if (tipo === 'radio') {
      // criação com radio só é aceita (bordos ficam vazios)
      // nada adicional necessário aqui
    }
  }

  // --- verifica se novos itens já estão vinculados em outras frotas ---
  const itensParaVerificar = [];
  if (tipo === 'radio' && radioIdNew && radioIdNew !== NOCHANGE) itensParaVerificar.push({ id: radioIdNew, type: 'Rádio' });
  if (tipo === 'bordos') {
    if (telaIdNew && telaIdNew !== NOCHANGE) itensParaVerificar.push({ id: telaIdNew, type: 'Tela' });
    if (magIdNew  && magIdNew  !== NOCHANGE) itensParaVerificar.push({ id: magIdNew,  type: 'Mag' });
    if (chipIdNew && chipIdNew !== NOCHANGE) itensParaVerificar.push({ id: chipIdNew, type: 'Chip' });
  }
    for (const item of itensParaVerificar) {
    const isReplacingCurrentItem =
      (item.type === 'Rádio' && item.id === radioIdExisting) ||
      (item.type === 'Tela'  && item.id === telaIdExisting) ||
      (item.type === 'Mag'   && item.id === magIdExisting) ||
      (item.type === 'Chip'  && item.id === chipIdExisting);
    if (isReplacingCurrentItem) continue;

    const isLinkedElsewhere = dbRegistros.some(reg =>
      (reg.radioId === item.id || reg.telaId === item.id || reg.magId === item.id || reg.chipId === item.id)
      && reg.equipamentoId !== equipamentoId
    );
    if (isLinkedElsewhere) {
      const itemDetails = dbRadios.find(r => r.id === item.id) || dbBordos.find(b => b.id === item.id);
      showModal('Item Já Vinculado', `${item.type} ${itemDetails?.serie || itemDetails?.numeroSerie || item.id} já está em uso em outra Frota. Desvincule-o primeiro.`, 'error');
      return;
    }

    // Validação de Sinistro: itens com status diferente de "Disponível" não podem ser vinculados
    const itemDetails = dbRadios.find(r => r.id === item.id) || dbBordos.find(b => b.id === item.id);
    if (itemDetails && itemDetails.status !== 'Disponível') {
      showModal('Item Indisponível', `${item.type} ${itemDetails?.serie || itemDetails?.numeroSerie || item.id} está com status "${itemDetails.status}" e não pode ser vinculado. Altere para "Disponível" primeiro.`, 'error');
      return;
    }
  }

  hideVincularModal();

  // garante código do equipamento (mesma lógica existente)
  const equipamentoRef = doc(db, `artifacts/${appId}/public/data/equipamentos`, equipamentoId);
  const equipamentoSnap = await getDoc(equipamentoRef);
  const equipamento = { id: equipamentoSnap.id, ...equipamentoSnap.data() };
  let codigoDoEquipamento = equipamento.codigo;
  if (!codigoDoEquipamento) {
    codigoDoEquipamento = generateCode(equipamento.grupo);
    if (!codigoDoEquipamento) return;
    try { await updateDoc(equipamentoRef, { codigo: codigoDoEquipamento }); }
    catch (e) { showModal('Erro', 'Não foi possível salvar o novo código no equipamento.', 'error'); return; }
  }

  // --- montar batch apenas com as alterações do tipo atual ---
  const batch = writeBatch(db);
  let targetRegId = existingReg ? existingReg.id : null;

  const itemsToUnlink = [];

  if (tipo === 'radio') {
    // Só aplicar mudanças no rádio
    if (radioIdNew !== NOCHANGE && radioIdNew !== radioIdExisting) {
      if (radioIdExisting) itemsToUnlink.push({ id: radioIdExisting, type: 'radios' });
      radioToUse = radioIdNew; // pode ser null (desvincular sem substituto) ou um novo id
      if (radioIdNew) {
        const radioRef = doc(db, `artifacts/${appId}/public/data/radios`, radioIdNew);
        batch.update(radioRef, { status: 'Em Uso' });
      }
    } else {
      radioToUse = radioIdExisting;
    }
    // bordos mantidos como estavam
    telaToUse = telaIdExisting;
    magToUse  = magIdExisting;
    chipToUse = chipIdExisting;
  } else if (tipo === 'bordos') {
    // Só aplicar mudanças nos bordos (cada campo independentemente)
    const bordoFields = [
      { newId: telaIdNew, existingId: telaIdExisting, field: 'telaId', type: 'bordos' },
      { newId: magIdNew,  existingId: magIdExisting,  field: 'magId',  type: 'bordos' },
      { newId: chipIdNew, existingId: chipIdExisting, field: 'chipId', type: 'bordos' }
    ];
    bordoFields.forEach(item => {
      if (item.newId !== NOCHANGE && item.newId !== item.existingId) {
        if (item.existingId) itemsToUnlink.push({ id: item.existingId, type: 'bordos' });
        if (item.field === 'telaId') telaToUse = item.newId; // pode ser null (desvincular) ou um novo id
        if (item.field === 'magId')  magToUse  = item.newId;
        if (item.field === 'chipId') chipToUse = item.newId;
        if (item.newId) {
          const bordoRef = doc(db, `artifacts/${appId}/public/data/bordos`, item.newId);
          batch.update(bordoRef, { status: 'Em Uso' });
        }
      } else {
        // mantém existentes se não foi alterado ou select não existe
        if (item.field === 'telaId') telaToUse = item.existingId;
        if (item.field === 'magId')  magToUse  = item.existingId;
        if (item.field === 'chipId') chipToUse = item.existingId;
      }
    });
    // rádio mantido como estava
    radioToUse = radioIdExisting;
  } else {
    // caso geral (se a função for chamada sem tipo correto) - manter tudo
    radioToUse = radioIdExisting;
    telaToUse  = telaIdExisting;
    magToUse   = magIdExisting;
    chipToUse  = chipIdExisting;
  }

  // liberar status dos itens substituídos
  itemsToUnlink.forEach(item => {
    const itemRef = doc(db, `artifacts/${appId}/public/data/${item.type}`, item.id);
    batch.update(itemRef, { status: 'Disponível' });
  });

  // construir finalRecord preservando campos não alterados
  const finalRecord = {
    equipamentoId,
    codigo: codigoDoEquipamento,
    radioId: radioToUse || null,
    telaId:  telaToUse  || null,
    magId:   magToUse   || null,
    chipId:  chipToUse  || null
  };

  const hasAnyLink = finalRecord.radioId || finalRecord.telaId || finalRecord.magId || finalRecord.chipId;

  if (isEditingMode) {
    if (hasAnyLink) {
      batch.update(doc(db, `artifacts/${appId}/public/data/registros`, targetRegId), finalRecord);
    } else {
      batch.delete(doc(db, `artifacts/${appId}/public/data/registros`, targetRegId));
    }
  } else {
    // novo registro: se não houver link válido, abortar (salvaguarda)
    if (!hasAnyLink) {
      showModal('Erro', 'Nenhum item selecionado para criar o vínculo.', 'error');
      return;
    }
    const newRegRef = doc(collection(db, `artifacts/${appId}/public/data/registros`));
    batch.set(newRegRef, { ...finalRecord, createdAt: new Date().toISOString() });
  }

  try {
    await batch.commit();
    const msg = isEditingMode ? `Vínculos da Frota ${equipamento.frota} atualizados com sucesso!` : `Novo Vínculo criado. Código: ${codigoDoEquipamento}`;
    showModal('Sucesso!', msg, 'success');
    await refreshDataFromFirestore();
  } catch (error) {
    console.error("Erro ao salvar associação:", error);
    showModal('Erro', 'Ocorreu um erro ao salvar a associação.', 'error');
  }
}

// REMOVIDA: loadGeralForVincular()

// A função original deleteRecord é mantida para ser usada apenas para excluir Duplicidades.
async function deleteRecord(collectionName, id) {
    if (!db || !appId) {
        showModal('Erro', 'Conexão com o banco de dados perdida.', 'error');
        return;
    }
    
    // [CORREÇÃO] Usa appId hardcoded
    const colPath = `artifacts/${appId}/public/data/${collectionName}`;

    try {
        if (collectionName === 'registros') {
             // Redireciona para a desvinculação completa (deleteLink para radio - que faz a exclusão total se não houver bordos)
             // A função deleteLink já trata de limpar todos os vínculos
             await deleteLink(id, 'radio'); // Simula a desvinculação completa via radio.
             // Fazemos o mesmo para bordos para garantir a exclusão do registro se o rádio já tiver sido removido
             await deleteLink(id, 'bordos');
             showModal('Sucesso', 'Associação completa desvinculada e itens atualizados com sucesso!', 'success');
        } else {
            // Lógica de inativação foi movida para toggleRecordAtivo
            showModal('Erro', 'Ação não suportada. Use a função de Inativação/Ativação.', 'error');
        }
    } catch (error) {
        console.error("Erro ao deletar/desvincular registro:", error);
        showModal('Erro', 'Ocorreu um erro durante a operação.', 'error');
    }
}

async function toggleRecordAtivo(collectionName, id) {
    if (!db || !appId || (collectionName !== 'radios' && collectionName !== 'equipamentos' && collectionName !== 'bordos')) {
        showModal('Erro', 'Ação inválida.', 'error');
        return;
    }
    
    // [CORREÇÃO] Usa appId hardcoded
    const colPath = `artifacts/${appId}/public/data/${collectionName}`;

    try {
        const docRef = doc(db, colPath, id);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            showModal('Erro', 'Registro não encontrado.', 'error');
            return;
        }

        const currentData = docSnap.data();
        // Alterna o estado. Se ativo for false, vira true. Se for true ou undefined, vira false.
        const newAtivoState = !(currentData.ativo !== false);	

        // Se está tentando INATIVAR, checa as regras de bloqueio
        if (newAtivoState === false) {	
            if (collectionName === 'radios' && dbRegistros.some(reg => reg.radioId === id)) {
                showModal('Ação Bloqueada', 'Não é possível inativar um rádio que está vinculado.\n\nDesvincule na aba "Geral" primeiro.', 'error');
                return;
            }
            // CORREÇÃO CRÍTICA: Bloqueia inativação de equipamento se houver QUALQUER vínculo (Rádio ou Bordos)
            if (collectionName === 'equipamentos' && dbRegistros.some(reg => reg.equipamentoId === id)) {
                showModal('Ação Bloqueada', 'Não é possível inativar um equipamento que possui vínculos (Rádio e/ou Bordos).\n\nDesvincule na aba "Geral" primeiro.', 'error');
                return;
            }
            // 🌟 NOVO: Bloqueio para Bordos
            if (collectionName === 'bordos') {
                const isLinked = dbRegistros.some(reg => reg.telaId === id || reg.magId === id || reg.chipId === id);
                if (isLinked) {
                    showModal('Ação Bloqueada', `Não é possível inativar o Bordo (${currentData.tipo}) que está vinculado.\n\nDesvincule na aba "Geral" primeiro.`, 'error');
                    return;
                }
            }
        }
        
        // Atualiza o status
        await updateDoc(docRef, { ativo: newAtivoState });	
        showModal('Sucesso', `Registro ${newAtivoState ? 'ATIVADO' : 'INATIVADO'} com sucesso!`, 'success');
        await refreshDataFromFirestore();
        
    } catch (error) {
        console.error("Erro ao alternar status do registro:", error);
        showModal('Erro', 'Ocorreu um erro durante a operação.', 'error');
    }
}

async function deleteDuplicity(collectionName, id) {
    if (!db || !appId) {
        showModal('Erro', 'Conexão com o banco de dados perdida.', 'error');
        return;
    }

    // Bloqueia a exclusão se o item estiver vinculado a um registro ativo
    let isLinked = false;
    if (collectionName === 'radios') {
        isLinked = dbRegistros.some(reg => reg.radioId === id);
    } else if (collectionName === 'equipamentos') {
        // CORREÇÃO: Equipamento duplicado não pode ser excluído se tiver algum registro de associação
        isLinked = dbRegistros.some(reg => reg.equipamentoId === id);
    } else if (collectionName === 'bordos') {
        isLinked = dbRegistros.some(reg => reg.telaId === id || reg.magId === id || reg.chipId === id);
    }
    
    if (isLinked) {
        showModal('Ação Bloqueada', 'Não é possível excluir este item. Ele está atualmente vinculado a um registro ativo.', 'warning');
        return;
    }

    // [CORREÇÃO] Usa appId hardcoded
    const colPath = `artifacts/${appId}/public/data/${collectionName}`;

    try {
        // Tenta excluir o documento
        await deleteDoc(doc(db, colPath, id));

        await refreshDataFromFirestore(); // ja roda checkDuplicities() internamente
        renderApp();

        // CORRECAO: NAO fecha mais o modal de duplicidades a cada exclusao.
        // Antes disso, o modal fechava sozinho apos remover 1 item, entao quando o
        // usuario reabria o sino de novo, parecia que "nada tinha sido excluido"
        // (o grupo ainda aparecia, so que com uma copia a menos). Agora a lista e
        // re-renderizada no proprio modal, que continua aberto.
        renderDuplicityModalContent();
        showModal('Sucesso', 'Duplicidade removida com sucesso!', 'success');

    } catch (error) {
        console.error("Erro ao excluir duplicidade:", error);
        showModal('Erro', 'Ocorreu um erro ao excluir a duplicidade. Verifique sua permissao de administrador.', 'error');
    }
}

/**
 * NOVO: Sanitizacao em massa de duplicidades.
 *
 * Para cada grupo de duplicatas (mesma Serie/Frota/Tipo+Serie), mantem UM unico
 * registro (o que estiver vinculado a uma Frota, se houver; senao o mais antigo
 * pela data de criacao) e apaga todos os outros em lote. Itens vinculados nunca
 * sao apagados - se por algum motivo mais de um item do mesmo grupo estiver
 * vinculado (inconsistencia anterior), ambos sao mantidos e reportados para
 * revisao manual.
 */
async function sanitizeDuplicities() {
    if (!db || !appId) {
        showModal('Erro', 'Conexao com o banco de dados perdida.', 'error');
        return;
    }
    if (duplicities.length === 0) {
        showModal('Aviso', 'Nao ha duplicidades para sanitizar.', 'info');
        return;
    }

    const groups = duplicities.reduce((acc, item) => {
        const key = `${item.collection}-${item.value}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    const isItemLinked = (item) => {
        if (item.collection === 'radios') return dbRegistros.some(reg => reg.radioId === item.id);
        if (item.collection === 'equipamentos') return dbRegistros.some(reg => reg.equipamentoId === item.id);
        if (item.collection === 'bordos') return dbRegistros.some(reg => reg.telaId === item.id || reg.magId === item.id || reg.chipId === item.id);
        return false;
    };

    const idsToDelete = [];
    let multiplosVinculadosCount = 0;

    Object.values(groups).forEach(items => {
        const linked = items.filter(isItemLinked);
        let survivors;
        if (linked.length === 1) {
            survivors = [linked[0]];
        } else if (linked.length > 1) {
            // Inconsistencia rara: mais de um vinculado no mesmo grupo - mantem todos os vinculados, nao apaga nenhum deste grupo.
            survivors = linked;
            multiplosVinculadosCount++;
        } else {
            // Nenhum vinculado: mantem o registro mais antigo (primeiro cadastrado)
            const sorted = [...items].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            survivors = [sorted[0]];
        }
        const survivorIds = new Set(survivors.map(s => s.id));
        items.forEach(item => {
            if (!survivorIds.has(item.id)) idsToDelete.push(item);
        });
    });

    if (idsToDelete.length === 0) {
        showModal('Aviso', 'Nenhum registro pode ser removido automaticamente (todos os grupos possuem mais de um item vinculado). Revise manualmente.', 'warning');
        return;
    }

    showConfirmModal(
        'Confirmar Sanitizacao em Massa',
        `Isso ira EXCLUIR PERMANENTEMENTE <b>${idsToDelete.length}</b> registro(s) duplicado(s), mantendo apenas 1 item por Serie/Frota/Tipo+Serie (priorizando o item vinculado a uma Frota, ou o mais antigo). Esta acao nao pode ser desfeita. Deseja continuar?`,
        async () => {
            try {
                // Firestore permite no maximo 500 operacoes por batch - respeitamos 450 por seguranca.
                let batch = writeBatch(db);
                let opsInBatch = 0;
                const batches = [];

                idsToDelete.forEach(item => {
                    const ref = doc(db, `artifacts/${appId}/public/data/${item.collection}`, item.id);
                    batch.delete(ref);
                    opsInBatch++;
                    if (opsInBatch >= 450) {
                        batches.push(batch);
                        batch = writeBatch(db);
                        opsInBatch = 0;
                    }
                });
                if (opsInBatch > 0) batches.push(batch);

                for (const b of batches) {
                    await b.commit();
                }

                await refreshDataFromFirestore();
                renderApp();

                let msg = `${idsToDelete.length} registro(s) duplicado(s) removido(s) com sucesso!`;
                if (multiplosVinculadosCount > 0) {
                    msg += `<br><span class="text-yellow-600 dark:text-yellow-400">${multiplosVinculadosCount} grupo(s) tinham mais de um item vinculado e precisam de revisao manual.</span>`;
                }
                showModal('Sanitizacao Concluida', msg, 'success');
                renderDuplicityModalContent();
            } catch (error) {
                console.error('Erro ao sanitizar duplicidades:', error);
                showModal('Erro', 'Ocorreu um erro durante a sanitizacao em massa. Verifique sua permissao de administrador.', 'error');
            }
        }
    );
}
window.sanitizeDuplicities = sanitizeDuplicities;


// --- Funções de CRUD de Usuário (ATUALIZADO PARA CUSTOM LOGIN) ---

function loadUserForEdit(id) {
    const user = settings.users.find(u => u.id === id);
    if (user) {
        document.getElementById('user-id').value = user.id;
        document.getElementById('user-name').value = user.name;
        document.getElementById('user-username').value = user.username; // Email
        document.getElementById('user-custom-username').value = user.customUsername || '';
        document.getElementById('user-role').value = user.role;
        
        // Oculta o campo de senha para edição
        document.getElementById('user-password-field').classList.add('hidden');
        document.getElementById('user-password').value = '';

        // Carrega as permissões do usuário nos checkboxes
        const perms = user.permissions || { dashboard: true, cadastro: true, pesquisa: true, settings: false };
        document.getElementById('perm-dashboard').checked = perms.dashboard !== false;
        document.getElementById('perm-cadastro').checked = perms.cadastro !== false;
        document.getElementById('perm-pesquisa').checked = perms.pesquisa !== false;
        document.getElementById('perm-settings').checked = perms.settings === true;
        document.getElementById('perm-settings').disabled = user.role !== 'admin';

        document.getElementById('user-form-title').textContent = 'Editar Perfil de Usuário';
        showModal('Edição', `Carregando perfil de ${user.name} para edição.`, 'info');
        window.scrollTo(0, 0);
    } else {
        showModal('Erro', 'Usuário não encontrado.', 'error');
    }
}

async function saveUser(e) {
    e.preventDefault();
    const id = document.getElementById('user-id').value;
    const name = document.getElementById('user-name').value.trim();
    let email = document.getElementById('user-username').value.trim();
    const customUsername = document.getElementById('user-custom-username').value.trim();
    const password = document.getElementById('user-password').value;
    const role = document.getElementById('user-role').value;
    
    if (!name || !role) {
        showModal('Erro', 'Nome Completo e Perfil são obrigatórios.', 'error');
        return;
    }

    let finalEmail = email;
    if (customUsername) {
        if (!finalEmail) {
            finalEmail = createGenericEmail(customUsername, appId);
        }
    } else {
        if (!finalEmail || !isEmail(finalEmail)) {
            showModal('Erro', 'É necessário informar um Email válido ou um Nome de Usuário.', 'error');
            return;
        }
    }

    const isEditing = !!id;
    const usersFromDB = settings.users; 

    const isDuplicate = usersFromDB.some(u => 
        (u.username === finalEmail || (customUsername && u.customUsername === customUsername)) && 
        (!isEditing || u.id !== id)
    );

    if (isDuplicate) {
        showModal('Erro', `Este usuário ou email (${finalEmail}) já está cadastrado no sistema.`, 'error');
        return;
    }

    if (!isEditing) {
        if (password.length < 6) {
            showModal('Erro', 'A senha deve ter no mínimo 6 caracteres.', 'error');
            return;
        }
        try {
            await createUserWithEmailAndPassword(auth, finalEmail, password);
        } catch (e) {
            if (e.code === 'auth/email-already-in-use') {
                showModal('Aviso', `O login ${finalEmail} já existe no Firebase Auth. O perfil local será apenas criado/sincronizado.`, 'warning');
            } else {
                console.error(e);
                showModal('Erro de Auth', `Não foi possível criar o login: ${e.message}`, 'error');
                return; 
            }
        }
    }

    let userToSave;
    
    if (isEditing) {
        userToSave = usersFromDB.find(u => u.id === id);
        if (!userToSave) {
            showModal('Erro', 'Usuário original não encontrado.', 'error');
            return;
        }
        userToSave.name = name;
        userToSave.username = finalEmail;
        userToSave.customUsername = customUsername;
        userToSave.role = role;
        userToSave.permissions = {
            dashboard: document.getElementById('perm-dashboard').checked,
            cadastro: document.getElementById('perm-cadastro').checked,
            pesquisa: document.getElementById('perm-pesquisa').checked,
            settings: document.getElementById('perm-settings').checked
        };

        if (password.length >= 6 && customUsername) {
            userToSave.loginPassword = password; 
        }
    } else {
        userToSave = { 
            id: crypto.randomUUID(), 
            name, 
            username: finalEmail, 
            customUsername, 
            role, 
            permissions: {
                dashboard: document.getElementById('perm-dashboard').checked,
                cadastro: document.getElementById('perm-cadastro').checked,
                pesquisa: document.getElementById('perm-pesquisa').checked,
                settings: document.getElementById('perm-settings').checked
            }
        };
        if (customUsername) {
            userToSave.loginPassword = password;
        }
        // Adiciona na lista local para refletir na UI imediatamente, mas o arrayUnion garante o banco
        // (Se não for duplicado visualmente)
        if (!usersFromDB.some(u => u.id === userToSave.id)) {
             usersFromDB.push(userToSave);
        }
    }

    // --- CORREÇÃO FEITA AQUI: Descomentei o try ---
    try {
        const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");

        if (isEditing) {
            // --- MODO EDIÇÃO ---
            const snap = await getDoc(settingsDocRef);
            let currentUsers = snap.exists() ? snap.data().users || [] : [];

            const idx = currentUsers.findIndex(u => u.id === id);
            if (idx !== -1) {
                currentUsers[idx] = userToSave;
            } else {
                currentUsers.push(userToSave);
            }

            await setDoc(settingsDocRef, { users: currentUsers }, { merge: true });
            settings.users = currentUsers;

        } else {
            // --- MODO CRIAÇÃO ---
            await setDoc(settingsDocRef, {
                users: arrayUnion(userToSave)
            }, { merge: true });
        }

        // Sincroniza com a coleção users/{email} para aparecer no Firebase Console
        const userDocRef = doc(db, "artifacts", appId, "public", "data", "users", finalEmail);
        await setDoc(userDocRef, userToSave);

        showModal('Sucesso', `Perfil de ${name} salvo com sucesso! Login ativo.`, 'success');
        renderApp();
        
        setTimeout(() => {
            const currentForm = document.getElementById('form-user');
            if (currentForm) {
                currentForm.reset();
                document.getElementById('user-id').value = '';
                document.getElementById('perm-dashboard').checked = true;
                document.getElementById('perm-cadastro').checked = true;
                document.getElementById('perm-pesquisa').checked = true;
                document.getElementById('perm-settings').checked = false;
                const titleEl = document.getElementById('user-form-title');
                if(titleEl) titleEl.textContent = 'Novo Perfil de Usuário';
                const passField = document.getElementById('user-password-field');
                if(passField) passField.classList.remove('hidden');
            }
        }, 100);

    } catch (e) {
        console.error("Erro ao salvar no Firestore:", e);
        showModal('Erro', 'O login foi criado no Auth, mas houve falha ao salvar os dados no banco de dados.', 'error');
    }
}

// app.js (Substituir a partir da linha 1386)
async function deleteUser(id) {
    const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");
    
    // 1. Precisamos encontrar o objeto EXATO do usuário para o arrayRemove
    // (Usamos a lista local 'settings.users' que está em memória para isso)
    const userToDelete = settings.users.find(u => u.id === id);
    
    if (!userToDelete) {
        showModal('Erro', 'Usuário não encontrado para exclusão.', 'error');
        return;
    }

    const userName = userToDelete.name;
    const userUsername = userToDelete.username;

    // Bloqueia exclusão do admin principal
    if (userUsername === ADMIN_PRINCIPAL_EMAIL) {
        showModal('Bloqueado', 'O usuário principal (Admin) não pode ser excluído.', 'warning');
        return;
    }
    
    try {
        // --- AQUI ESTÁ A CORREÇÃO DEFINITIVA ---
        // Em vez de 'setDoc' com a lista modificada...
        // ...usamos 'updateDoc' com 'arrayRemove'.
        await updateDoc(settingsDocRef, {
            users: arrayRemove(userToDelete)
        });

        // Remove também da coleção users/{email}
        const userDocRef = doc(db, "artifacts", appId, "public", "data", "users", userUsername);
        await deleteDoc(userDocRef);

        // Atualiza a memória local (só depois que o banco confirmou)
        settings.users = settings.users.filter(u => u.id !== id);

        showModal('Sucesso', `Perfil de ${userName} excluído com sucesso!`, 'success');
        renderApp(); 
    } catch (e) {
        showModal('Erro', 'Não foi possível excluir o perfil no banco de dados.', 'error');
    }
}

// --- Funções de Gerenciamento de Pendências (Novo) ---

async function approveUser(pendingId, name, email, tempPassword) {
    if (!db || !appId || !currentUser || currentUser.role !== 'admin') {
        showModal('Acesso Negado', 'Você não tem permissão ou conexão para realizar esta ação.', 'error');
        return;
    }

    // 1. Tenta criar o Usuário no Firebase Authentication (Login real)
    try {
        await createUserWithEmailAndPassword(auth, email, tempPassword);
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            console.warn(`O email ${email} já existia no Auth. Prosseguindo para criar no Banco de Dados.`);
        } else {
            console.error("Erro ao criar no Auth:", e);
            showModal('Erro Crítico', `O Firebase recusou a criação da senha: ${e.message}`, 'error');
            return; // Aborta tudo se não conseguir criar o login
        }
    }

    // 2. Se o login foi criado (ou já existia), agora salvamos os DADOS no Firestore
    try {
        const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");

        // Define o novo usuário que queremos ADICIONAR
        const newUser = { 
            id: crypto.randomUUID(), 
            name: name, 
            username: email, // Este email deve bater com o Authentication
            role: 'user', // Padrão: usuário comum
            permissions: { dashboard: true, cadastro: true, pesquisa: true, settings: false }
        };

        // 3. Executa a gravação no banco e remove a pendência (Batch = Atômico)
        const batch = writeBatch(db);
        
        // --- AQUI ESTÁ A CORREÇÃO DEFINITIVA ---
        // Em vez de 'update' com a lista lida (arriscada), usamos 'arrayUnion'.
        // Isso adiciona atomicamente o 'newUser' ao array 'users' no banco.
        // Usamos set com merge:true para criar o doc 'settings' se ele não existir.
        batch.set(settingsDocRef, { 
            users: arrayUnion(newUser) 
        }, { merge: true });
        
        // Remove da lista de pendências
        const pendingDocRef = doc(db, `artifacts/${appId}/public/data/pending_approvals`, pendingId);
        batch.delete(pendingDocRef);

        await batch.commit();

        // Sincroniza com a coleção users/{email} para aparecer no Firebase Console
        const userDocRef = doc(db, "artifacts", appId, "public", "data", "users", email);
        await setDoc(userDocRef, newUser);

        // Atualiza a memória local (agora precisamos recarregar as settings)
        // A forma mais segura é forçar um reload das settings locais:
        await loadInitialSettings(); 
        
        hideModal();
        showModal('Sucesso', `Usuário <b>${name}</b> aprovado!<br>Login: ${email}<br>Senha: ${tempPassword}<br><br>Ele já pode logar.`, 'success');
        
        // Atualiza a tela
        renderApp();

    } catch (e) {
        // ... (O restante do seu catch de erro)
        console.error("Erro ao salvar dados no Firestore:", e);
        showModal('Erro de Dados', 'O login foi criado, mas houve erro ao salvar os dados no sistema. Tente atualizar a página.', 'error');
    }
}

// NOVO: Função para solicitar acesso
async function handleSolicitarAcesso(e) {
    e.preventDefault();
    
    const form = e.target;
    const nome = form['solicitar-name'].value.trim();
    const email = form['solicitar-email'].value.trim();
    const telefone = form['solicitar-phone'].value.trim();
    const senhaProvisoria = form['solicitar-temp-password'].value.trim();

    if (!nome || !email || !telefone || !senhaProvisoria) {
        showModal('Erro', 'Todos os campos são obrigatórios.', 'error');
        return;
    }
    if (!isEmail(email)) {
        showModal('Erro', 'Email inválido.', 'error');
        return;
    }
    if (senhaProvisoria.length < 6) {
        showModal('Erro', 'A Senha Provisória deve ter no mínimo 6 caracteres.', 'error');
        return;
    }

    // 1. Verificar se o email já está aprovado
    const appUser = settings.users.find(u => u.username === email);
    if (appUser) {
        showModal('Acesso Já Aprovado', 'Este email já possui um perfil aprovado. Tente o login.', 'info');
        return;
    }

    // 2. Verificar se já existe uma solicitação pendente com este email
    // [CORREÇÃO] Usa appId hardcoded
    const pendingColRef = collection(db, `artifacts/${appId}/public/data/pending_approvals`);
    const q = query(pendingColRef, where("email", "==", email));
    const pendingSnap = await getDocs(q);
    
    if (!pendingSnap.empty) {
        showModal('Solicitação Pendente', 'Este email já possui uma solicitação de acesso pendente. Aguarde a aprovação do administrador.', 'warning');
        return;
    }

    try {
        // 3. Envia a nova solicitação para o Firestore (Permissão permitida para qualquer usuário - Regra 1)
        await addDoc(pendingColRef, {
            name: nome,
            email: email,
            phone: telefone,
            tempPassword: senhaProvisoria, // A senha provisória é apenas para referência do Admin
            createdAt: new Date().toISOString()
        });

        showModal('Solicitação Enviada', 
            `Sua solicitação de acesso foi enviada com sucesso para aprovação. Você será notificado após a análise.`, 
            'success');
        
        // Volta para a tela de login principal
        form.reset();
        updateState('loginView', 'login');
    
    } catch (error) {
        showModal('Erro', 'Ocorreu um erro ao enviar sua solicitação.', 'error');
    }
}

function renderPendingApprovalsModal() {
    // Regra 1 permite apenas Admin Principal ler a coleção, mas vamos checar a role localmente
    if (currentUser.role !== 'admin') {
        showModal('Acesso Negado', 'Apenas administradores podem visualizar as solicitações de acesso.', 'error');
        return;
    }

    const pendingListHTML = pendingUsers.length > 0 ? 
        pendingUsers.map(u => `
            <div class="flex items-center justify-between p-3 border-b border-gray-100 last:border-b-0 bg-white dark:bg-gray-700 rounded-lg shadow-sm">
                <div>
                    <p class="font-semibold text-gray-800 dark:text-gray-100">${u.name}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-300">${u.email}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-300">Telefone: ${u.phone || 'N/A'}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-300">Senha Provisória: ${u.tempPassword || 'N/A'}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-300">Solicitado em: ${new Date(u.createdAt).toLocaleDateString()} ${new Date(u.createdAt).toLocaleTimeString()}</p>
                </div>
                <div class="flex space-x-2">
                    <button onclick="approveUserWrapper('${u.id}', '${u.name}', '${u.email}', '${u.tempPassword}')" class="px-3 py-1 text-xs bg-green-main text-white rounded-lg hover:bg-green-700 shadow-md transition-colors">
                        Aprovar
                    </button>
                    <button onclick="rejectUserWrapper('${u.id}', '${u.name}')" class="px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 shadow-md transition-colors">
                        Negar
                    </button>
                </div>
            </div>
        `).join('')
        : '<p class="text-gray-500 dark:text-gray-400 text-center py-4">Nenhuma solicitação de acesso pendente.</p>';

    const modal = document.getElementById('global-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    titleEl.textContent = `Aprovações Pendentes (${pendingUsers.length})`;
    // Remove a classe 'max-w-sm' do modal principal para permitir mais espaço
    modal.querySelector('div').classList.remove('max-w-sm');
    modal.querySelector('div').classList.add('max-w-lg'); 
    
    messageEl.innerHTML = `
        <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">Novos usuários aguardam sua aprovação.</p>
        <div class="max-h-80 overflow-y-auto space-y-3 p-2 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
            ${pendingListHTML}
        </div>
    `;
    titleEl.className = `text-xl font-bold mb-3 ${pendingUsers.length > 0 ? 'text-yellow-600' : 'text-gray-800 dark:text-gray-100'}`;

    actionsEl.innerHTML = `
        <button onclick="hideModal(); document.getElementById('global-modal').querySelector('div').classList.remove('max-w-lg'); document.getElementById('global-modal').querySelector('div').classList.add('max-w-sm');" 
                class="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors shadow-md">
            Fechar
        </button>
    `;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Wrappers para lidar com aspas em strings
window.approveUserWrapper = (id, name, email, tempPassword) => {
    showConfirmModal('Confirmar Aprovação', `Deseja aprovar o acesso de <b>${name}</b>? Ele receberá permissões de 'Usuário Padrão' e será criado no Auth com a senha provisória.`, () => approveUser(id, name, email, tempPassword));
};
window.rejectUserWrapper = (id, name) => {
    showConfirmModal('Confirmar Negação', `Deseja negar o acesso de <b>${name}</b>? A solicitação será removida.`, () => rejectUser(id, name));
};
window.renderPendingApprovalsModal = renderPendingApprovalsModal;


// 🌟 NOVO: Funções de Gerenciamento de Duplicidades 🌟

function renderDuplicityModalContent() {
    const modalContent = document.getElementById('duplicity-modal-content');
    
    if (duplicities.length === 0) {
        modalContent.innerHTML = '<p class="text-green-600 text-center font-semibold">Parabéns! Não foram encontradas duplicidades críticas.</p>';
        return;
    }

    const groups = duplicities.reduce((acc, item) => {
        const key = `${item.collection}-${item.value}`;
        if (!acc[key]) {
            acc[key] = { items: [], collection: item.collection, field: item.field, value: item.value };
        }
        acc[key].items.push(item);
        return acc;
    }, {});
    
    let html = '';

    // 🌟 NOVO: Botão de sanitização em massa (mantém 1 registro por grupo, apaga o resto)
    html += `
        <div class="flex justify-end mb-3">
            <button onclick="sanitizeDuplicities()" class="px-3 py-2 text-sm bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg shadow-md transition-colors flex items-center gap-2">
                <i class="fas fa-broom"></i> Sanitizar Automaticamente (remover todas as duplicatas)
            </button>
        </div>
    `;

    Object.values(groups).forEach(group => {
        // 🌟 ATUALIZADO: Inclui Bordos na label
        let typeLabel;
        if (group.collection === 'radios') typeLabel = 'Rádio (Série)';
        else if (group.collection === 'equipamentos') typeLabel = 'Equipamento (Frota)';
        else if (group.collection === 'bordos') typeLabel = `Bordo (Tipo/Série)`;
        else typeLabel = 'Item Desconhecido';
        
        const itemsList = group.items.map(item => {
            const date = new Date(item.createdAt).toLocaleString();
            let isLinked = false;
            // 🌟 ATUALIZADO: Checa vínculo para Bordos e Equipamentos também
            if (item.collection === 'radios') {
                isLinked = dbRegistros.some(reg => reg.radioId === item.id);
            } else if (item.collection === 'equipamentos') {
                isLinked = dbRegistros.some(reg => reg.equipamentoId === item.id);
            } else if (item.collection === 'bordos') {
                isLinked = dbRegistros.some(reg => reg.telaId === item.id || reg.magId === item.id || reg.chipId === item.id);
            }
            
            const actionButton = isLinked 
                ? `<span class="text-xs font-semibold text-red-500 bg-red-100 dark:bg-red-800/50 dark:text-red-300 px-2 py-1 rounded-full">EM USO</span>`
                : `<button onclick="deleteDuplicityWrapper('${item.collection}', '${item.id}', '${item.value}')" class="px-3 py-1 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 shadow-md transition-colors">
                    Remover Este
                   </button>`;

            return `
                <div class="flex justify-between items-center p-3 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-700 hover:bg-red-50/50 dark:hover:bg-red-900/20 transition-colors rounded-lg shadow-sm">
                    <div class="space-y-0.5">
                        <p class="font-semibold text-gray-800 dark:text-gray-100 break-words-all">ID: <span class="font-mono text-xs">${item.id}</span></p>
                        <p class="text-xs text-gray-600 dark:text-gray-300">Criado em: ${date}</p>
                    </div>
                    ${actionButton}
                </div>
            `;
        }).join('');

        html += `
            <div class="bg-red-50 dark:bg-red-900/10 p-4 rounded-xl shadow-inner border border-red-200 dark:border-red-700">
                <h4 class="text-lg font-bold text-red-700 dark:text-red-400 mb-3">${typeLabel}: ${group.value} (${group.items.length} duplicatas)</h4>
                <div class="space-y-2">
                    ${itemsList}
                </div>
                <p class="mt-3 text-xs text-red-700 dark:text-red-400 font-semibold">Regra: Mantenha um único registro. Registros "EM USO" não podem ser removidos.</p>
            </div>
        `;
    });

    modalContent.innerHTML = html;
}
// ----------------------------------------------------

// 🌟 NOVO: Lógica de Tema
function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    if (isDark) {
        localStorage.setItem('theme', 'dark');
    } else {
        localStorage.setItem('theme', 'light');
    }
    // Força a re-renderização apenas da TopBar para atualizar o botão
    if (currentUser) {
        renderApp();
    }
}

function renderThemeButton() {
    const isDark = document.documentElement.classList.contains('dark');
    const icon = isDark ? 'fas fa-sun' : 'fas fa-moon';
    const title = isDark ? 'Mudar para Tema Claro' : 'Mudar para Tema Escuro';

    return `
        <button onclick="toggleTheme()" class="icon-btn" title="${title}" aria-label="${title}">
            <i class="${icon}"></i>
        </button>
    `;
}
// ----------------------------------------------------


// --- Funções de PWA (Instalação) ---

/**
 * @NOVO: Função para fechar o modal PWA e registrar a ação do usuário (dismiss/install).
 * @param {string} action 'dismiss' ou 'install'.
 */
function handlePwaPromptClose(action) {
    if (pwaTimeoutId) {
        clearTimeout(pwaTimeoutId);
        pwaTimeoutId = null;
    }
    
    // Oculta o modal PWA customizado (não é o modal nativo)
    const pwaModal = document.getElementById('pwa-install-modal');
    if (pwaModal) {
        pwaModal.classList.add('hidden');
        pwaModal.classList.remove('flex');
    }
    
    // Registra a preferência do usuário
    if (action === 'dismiss' || action === 'timeout') {
        // Se fechou ou expirou, não mostra novamente por um tempo (ex: 7 dias)
        localStorage.setItem(PWA_PROMPT_KEY, 'dismissed');
    } else if (action === 'install') {
        // Se escolheu instalar, marca como "instalado" ou pelo menos não incomoda mais.
        localStorage.setItem(PWA_PROMPT_KEY, 'installed');
    }
    
    // Remove o deferredPrompt (só pode ser usado uma vez)
    deferredPrompt = null;
    
    // Força a re-renderização para limpar o estado
    renderApp();
}

/**
 * @NOVO: Exibe o modal de diálogo customizado PWA.
 */
function showInstallDialog() {
    // 1. Condição para não mostrar
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const dismissed = localStorage.getItem(PWA_PROMPT_KEY);
    
    if (isStandalone || dismissed === 'installed' || dismissed === 'dismissed' || !deferredPrompt) {
        return;
    }
    
    const modal = document.getElementById('pwa-install-modal');
    if (!modal) {
        // Se o modal customizado não existe, desista
        return;
    }
    
    // Limpa o timeout anterior, se existir
    if (pwaTimeoutId) clearTimeout(pwaTimeoutId);

    // 2. Monta o modal e anexa eventos
    const content = modal.querySelector('.modal-content');
    content.innerHTML = `
        <div class="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-2xl relative">
            <button onclick="handlePwaPromptClose('dismiss')" class="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <i class="fas fa-times"></i>
            </button>
            <h3 class="text-2xl font-bold text-green-main dark:text-green-400 mb-3 flex items-center">
                <i class="fas fa-mobile-alt mr-3"></i> Instalar como Aplicativo
            </h3>
            <p class="text-gray-700 dark:text-gray-300 mb-4">
                Para ter a melhor experiência e acesso rápido, instale o Gestão de Rádios diretamente na sua tela inicial.
            </p>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Esta caixa fechará automaticamente em 10 segundos.
            </p>
            <button id="pwa-install-button" class="btn btn--primary btn--block">
                <i class="fas fa-download mr-2"></i> Instalar Agora
            </button>
        </div>
    `;

    // 3. Lógica de Instalação no clique
    document.getElementById('pwa-install-button').onclick = async () => {
        handlePwaPromptClose('install'); // Fecha o modal customizado e registra a ação
        
        // Chamada ao prompt nativo do navegador
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                // Sucesso na instalação (opcional: showModal)
            }
        }
    };
    
    // 4. Inicia o Timeout de 10 segundos
    pwaTimeoutId = setTimeout(() => {
        if (deferredPrompt) {
            handlePwaPromptClose('timeout');
            showModal('Instalação', 'A solicitação de instalação expirou. Tente novamente mais tarde.', 'info');
        }
    }, 10000); // 10 segundos

    // 5. Exibe o modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function renderInstallButton() {
    // 🛑 CORREÇÃO: O botão foi removido, a instalação é automática via showInstallDialog()
    return '';
}

// --- Funções de Renderização (HTML) ---

function renderTopBar() {
    const allTabs = [
        { id: 'dashboard', name: 'Dashboard', icon: 'fa-chart-line' },
        { id: 'cadastro', name: 'Cadastro', icon: 'fa-box' },
        { id: 'pesquisa', name: 'Pesquisa', icon: 'fa-search' },
        { id: 'settings', name: 'Ajustes', icon: 'fa-cog', adminOnly: true },
    ];

    const tabs = allTabs.filter(tab => {
        if (!currentUser) return false;
        if (tab.id === 'settings' && currentUser.role !== 'admin') return false;
        return currentUser.role === 'admin' || (currentUser.permissions && currentUser.permissions[tab.id] === true);
    });

    const navItems = tabs.map(tab => `
        <button type="button"
            class="nav-seg__item ${currentPage === tab.id ? 'is-active' : ''}"
            aria-current="${currentPage === tab.id ? 'page' : 'false'}"
            onclick="updateState('page', '${tab.id}')">
            <i class="fas ${tab.icon}" aria-hidden="true"></i>
            <span>${tab.name}</span>
        </button>
    `).join('');

    const duplicityCount = duplicities.length;
    const duplicityBell = duplicityCount > 0 ? `
        <button onclick="showDuplicityModal()" class="icon-btn icon-btn--alert" title="Alerta crítico de duplicidade de dados" aria-label="Duplicidades detectadas">
            <i class="fas fa-bell duplicity-bell-active"></i>
            <span class="badge-count">${duplicityCount > 99 ? '99+' : duplicityCount}</span>
        </button>
    ` : `
        <button onclick="showDuplicityModal()" class="icon-btn" title="Integridade de dados (OK)" aria-label="Integridade de dados">
            <i class="fas fa-heart-pulse"></i>
        </button>
    `;

    const nameParts = (currentUser.name || '').trim().split(/\s+/).filter(Boolean);
    const initials = (nameParts.slice(0, 2).map(n => n[0]).join('') || '??').toUpperCase();
    const shortName = nameParts.slice(0, 2).join(' ') || 'Usuário';

    return `
        <header class="app-header">
            <div class="app-header__inner">
                <div class="brand">
                    <img src="https://usinapitangueiras.com.br/wp-content/uploads/2020/04/usina-pitangueiras-logo.png" alt="Usina Pitangueiras"
                        onerror="this.onerror=null; this.src='https://placehold.co/180x40/40800c/FFFFFF?text=Link-Frota'; this.alt='Link-Frota'">
                    <span class="brand__divider hidden sm:block"></span>
                    <div class="hidden sm:block min-w-0">
                        <p class="brand__name">Link-Frota</p>
                        <p class="brand__tag">Gestão de Frotas Agrícolas</p>
                    </div>
                </div>

                <nav class="nav-seg" aria-label="Navegação principal">
                    ${navItems}
                </nav>

                <div class="hdr-actions">
                    ${renderThemeButton()}
                    ${duplicityBell}
                    ${currentUser.role === 'admin' ? `
                    <button onclick="renderPendingApprovalsModal()" class="icon-btn" title="Novas solicitações de acesso" aria-label="Solicitações de acesso pendentes">
                        <i class="fas fa-inbox"></i>
                        ${pendingUsers.length > 0 ? `<span class="badge-count">${pendingUsers.length}</span>` : ''}
                    </button>` : ''}

                    <button onclick="showProfileModal()" class="user-chip" title="Perfil" aria-label="Abrir perfil">
                        <span class="user-chip__meta hidden sm:block">
                            <span class="user-chip__name block">${shortName}</span>
                            <span class="user-chip__role block">${currentUser.role === 'admin' ? 'Administrador' : 'Usuário'}</span>
                        </span>
                        <span class="avatar">${initials}</span>
                    </button>

                    <button onclick="handleLogout()" class="icon-btn icon-btn--danger" title="Sair" aria-label="Sair do sistema">
                        <i class="fas fa-right-from-bracket"></i>
                    </button>
                </div>
            </div>
        </header>

        <nav class="mobile-nav" aria-label="Navegação principal (mobile)">
            ${tabs.map(tab => `
                <a href="#${tab.id}" class="mobile-nav__item ${currentPage === tab.id ? 'is-active' : ''}"
                   aria-current="${currentPage === tab.id ? 'page' : 'false'}">
                    <i class="fas ${tab.icon}" aria-hidden="true"></i>
                    <span>${tab.name}</span>
                </a>
            `).join('')}
        </nav>`;
}

function renderLogin() {
    // [NOVO] Recupera o valor salvo (pode ser email ou username)
    const savedLogin = localStorage.getItem('rememberedLogin') || '';
    const rememberMeChecked = savedLogin ? 'checked' : '';
    
    let content;
    if (currentLoginView === 'login') {
        content = `
            <div class="text-center">
                <img src="https://usinapitangueiras.com.br/wp-content/uploads/2020/04/usina-pitangueiras-logo.png" alt="Logo Usina Pitangueiras"	
                    class="auth-logo"	
                    onerror="this.onerror=null; this.src='https://placehold.co/150x80/40800c/FFFFFF?text=Logo'; this.alt='Logo Placeholder'">
                <h2 class="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                    Acesso ao Sistema
                </h2>
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    Use seu email ou nome de usuário e senha para continuar
                </p>
            </div>
            <form id="login-form" class="mt-8 space-y-6">
                <input type="text" id="login-input" placeholder="Email ou Nome de Usuário" required	
                    class="w-full"
                    value="${savedLogin}"
                >
                <div class="relative">
                    <input type="password" id="password" placeholder="Senha" required	
                        class="w-full pr-10"
                        value=""
                    >
                    <button type="button" id="toggle-password" class="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 focus:outline-none" title="Mostrar/Ocultar Senha">
                        <i id="toggle-password-icon" class="fas fa-eye"></i>
                    </button>
                </div>
                
                <div class="flex items-center justify-between">
                    <div class="flex items-center">
                        <input id="remember-me" name="remember-me" type="checkbox" ${rememberMeChecked}
                            class="h-4 w-4 text-green-main border-gray-300 dark:border-gray-600 rounded focus:ring-green-main">
                        <label for="remember-me" class="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                            Lembrar Login
                        </label>
                    </div>
                </div>

                <button type="submit"	
                    class="btn btn--primary btn--block">
                    <i class="fas fa-lock mr-2"></i>
                    Entrar
                </button>
            </form>
            
            <button type="button" onclick="updateState('loginView', 'solicitar')"
                class="btn btn--secondary btn--block mt-4">
                <i class="fas fa-user-plus mr-2"></i>
                Solicitar Acesso
            </button>
        `;
    } else {
        content = renderSolicitarAcesso();
    }

    return `
        <div class="auth-bg">
            <div class="auth-card">
                ${content}
                <p class="auth-tagline">Usina Pitangueiras &middot; A energia que move a região</p>
            </div>
        </div>
    `;
}

function renderSolicitarAcesso() {
    return `
        <div class="text-center">
            <h2 class="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                Solicitar Acesso
            </h2>
            <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Preencha seus dados para enviar a solicitação de perfil.
            </p>
        </div>
        <form id="form-solicitar-acesso" class="mt-8 space-y-4" onsubmit="handleSolicitarAcesso(event)">
            <div>
                <input type="text" name="solicitar-name" placeholder="Nome Completo" required	
                    class="appearance-none relative block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-green-main focus:border-green-main sm:text-sm shadow-sm"
                >
            </div>
            <div>
                <input type="email" name="solicitar-email" placeholder="Email (obrigatório para solicitação)" required	
                    class="appearance-none relative block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-green-main focus:border-green-main sm:text-sm shadow-sm"
                >
            </div>
            <div>
                <input type="tel" name="solicitar-phone" placeholder="Telefone (WhatsApp)" required	
                    class="appearance-none relative block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-green-main focus:ring-green-main sm:text-sm shadow-sm"
                >
            </div>
            <div>
                <div class="relative">
                    <input type="password" id="temp-password" name="solicitar-temp-password" placeholder="Senha Provisória (Mín. 6 caracteres)" required minlength="6"	
                        class="appearance-none relative block w-full px-4 py-3 border border-gray-300 dark:border-gray-600 placeholder-gray-500 text-gray-900 dark:text-gray-100 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-green-main focus:border-green-main sm:text-sm shadow-sm pr-10"
                    >
                    <button type="button" id="toggle-temp-password" class="absolute inset-y-0 right-0 px-3 flex items-center text-gray-500 dark:text-gray-300 hover:text-gray-700 dark:hover:text-gray-100 focus:outline-none" title="Mostrar/Ocultar Senha">
                        <i id="toggle-temp-password-icon" class="fas fa-eye"></i>
                    </button>
                </div>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400 text-left">A senha provisória será usada para configurar seu acesso inicial.</p>
            </div>
            
            <button type="submit"	
                class="btn btn--primary btn--block">
                <i class="fas fa-paper-plane mr-2"></i>
                Enviar Solicitação
            </button>

            <button type="button" onclick="updateState('loginView', 'login')"
                class="group relative w-full flex justify-center py-2 px-4 border border-gray-300 dark:border-gray-600 text-sm font-medium rounded-lg text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all shadow-sm mt-3">
                <i class="fas fa-arrow-left mr-2"></i>
                Voltar para Login
            </button>
        </form>
    `;
}

function renderLoadingScreen() {
    return `
        <div class="flex flex-col items-center justify-center min-h-screen bg-[#40800c]">
            <img src="https://usinapitangueiras.com.br/wp-content/uploads/2020/04/usina-pitangueiras-logo.png" alt="Logo Usina Pitangueiras"	
                class="h-80 w-auto mb-10 loader-logo-full object-contain image-rendering:auto"	
                onerror="this.onerror=null; this.src='https://placehold.co/200x100/40800c/FFFFFF?text=Logo'; this.alt='Logo Placeholder'">
                
            <h1 class="text-3xl font-extrabold text-gray-900 tracking-widest loading-text-animate">
                SISTEMA RÁDIOS
            </h1>
            <p class="mt-4 text-sm text-gray-900 dark:text-gray-900 italic loading-text-animate">Aguarde o carregamento...</p>
        </div>
    `;
}

// --- Funções para Ícones SVG (Design mais moderno e controlável) ---
function getRadioIcon() {
    // Símbolo de rádio/onda (ajustado para a nova cor)
    return `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
            <line x1="12" y1="4" x2="12" y2="20"></line>
            <path d="M5 8h2M5 12h2M5 16h2M17 8h2M17 12h2M17 16h2"></path>
            <circle cx="12" cy="12" r="3" fill="#ffffff" stroke="none"></circle>
        </svg>
    `;
}

function getActiveRadioIcon() {
    // Símbolo de torre de transmissão (ajustado para a nova cor)
    return `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v6"></path>
            <path d="M16 4h4a2 2 0 0 1 2 2v2M8 4H4a2 2 0 0 0-2 2v2"></path>
            <path d="M20 12h2M2 12h2"></path>
            <path d="M18 16h4a2 2 0 0 1 2 2v2M6 16H2a2 2 0 0 0-2 2v2"></path>
            <circle cx="12" cy="12" r="3" fill="#ffffff" stroke="none"></circle>
            <path d="M12 15v7"></path>
        </svg>
    `;
}

function getMaintenanceIcon() {
    // Símbolo de Chave de manutenção (ajustado para a nova cor)
    return `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.77 3.77z"></path>
        </svg>
    `;
}

function getWarehouseIcon() {
    // Símbolo de estoque/armazém (ajustado para a nova cor)
    return `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 21V8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v13"></path>
            <path d="M3 13h18"></path>
            <path d="M3 17h18"></path>
            <path d="M10 3L12 6L14 3"></path>
            <rect x="5" y="10" width="4" height="4" rx="1"></rect>
            <rect x="15" y="10" width="4" height="4" rx="1"></rect>
        </svg>
    `;
}

function getSinistroIcon() {
    // Símbolo de Alerta/Perigo/Risco
    return `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12" y2="17"></line>
        </svg>
    `;
}

// 🌟 NOVO: Ícone para itens de Bordo
function getBordoIcon() {
    // Símbolo de chip / circuito
    return `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
            <rect x="9" y="9" width="6" height="6"></rect>
            <path d="M15 2h2"></path><path d="M15 22h2"></path><path d="M2 15v2"></path><path d="M22 15v2"></path>
            <path d="M9 2h-2"></path><path d="M9 22h-2"></path><path d="M2 9v2"></path><path d="M22 9v2"></path>
        </svg>
    `;
}

function getBordoKitIcon() {
    // Símbolo de empilhamento de componentes/kits
    return `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="9" width="20" height="13" rx="2" ry="2"></rect>
            <path d="M12 2v7"></path>
            <path d="M7 6h10"></path>
            <path d="M7 14h10"></path>
            <path d="M7 18h10"></path>
        </svg>
    `;
}


// --- NOVA FUNÇÃO PARA AVATAR/IMAGEM DE PERFIL ---
function getUserAvatar(user) {
    const defaultColor = 'bg-indigo-500';
    // Pega as iniciais do nome
    const initials = (user.name || 'NN').split(' ').map(n => n[0]).join('').toUpperCase();
    // Simula URL de foto (se disponível no objeto user, embora não seja comum no Auth sem provedor social)
    const photoURL = user.photoURL || null; 

    if (photoURL) {
        return `<img src="${photoURL}" alt="Avatar de ${user.name}" class="h-8 w-8 rounded-full object-cover shadow-md" onerror="this.onerror=null; this.src='https://placehold.co/32x32/40800c/FFFFFF?text=${initials}';">`;
    }

    return `
        <div class="h-8 w-8 rounded-full ${defaultColor} flex items-center justify-center text-white font-bold text-sm shadow-md ring-2 ring-green-main/50">
            ${initials}
        </div>
    `;
}



//Inicio da função dos dashboards


function renderDashboard() {
    
    // --- 1. Cálculos de Rádios ---
    const activeRadios = dbRadios.filter(r => r.ativo !== false);
    const totalRadios = activeRadios.length;
    const radiosEmUso = activeRadios.filter(r => r.status === 'Em Uso').length;
    const radiosDisponiveis = activeRadios.filter(r => r.status === 'Disponível').length;
    const radiosManutencao = activeRadios.filter(r => r.status === 'Manutenção').length;
    const radiosSinistro = activeRadios.filter(r => r.status === 'Sinistro').length;

    // --- 2. Cálculos de Bordos (Início) ---
    const activeBordos = dbBordos.filter(b => b.ativo !== false);

    // --- Cálculo de Stats de Bordos (Resumo por Tipo) ---
    const bordoStats = {
        Tela: { Total: 0, 'Em Uso': 0, 'Disponível': 0, 'Manutenção': 0, 'Sinistro': 0 },
        Mag: { Total: 0, 'Em Uso': 0, 'Disponível': 0, 'Manutenção': 0, 'Sinistro': 0 },
        Chip: { Total: 0, 'Em Uso': 0, 'Disponível': 0, 'Manutenção': 0, 'Sinistro': 0 }
    };
    
    activeBordos.forEach(b => {
        if (bordoStats[b.tipo]) {
            bordoStats[b.tipo].Total++;
            const statusKey = b.status || 'Disponível';
            if (bordoStats[b.tipo][statusKey] !== undefined) {
                bordoStats[b.tipo][statusKey]++;
            }
        }
    });


    // --- 2. Cálculos de Bordos (Continuação) ---
    
    // "Total Componentes" (Total de itens individuais: Tela + Mag + Chip)
    const totalBordos = activeBordos.length;
    const totalKits = Math.min(bordoStats.Tela.Total, bordoStats.Mag.Total, bordoStats.Chip.Total);
    
    // 🌟 CORREÇÃO: "Kits em Uso" (Total de kits completos instalados)
    // Conta quantos registros de vínculo possuem os 3 itens de bordo.
    const bordosEmUso = dbRegistros.filter(reg => reg.telaId && reg.magId && reg.chipId).length;
    
    // Contagem de Disponíveis (para "Kits Disponíveis")
    const bordosDisponiveis = activeBordos.filter(b => b.status === 'Disponível');
    const dispTelas = bordosDisponiveis.filter(b => b.tipo === 'Tela').length;
    const dispMags = bordosDisponiveis.filter(b => b.tipo === 'Mag').length;
    const dispChips = bordosDisponiveis.filter(b => b.tipo === 'Chip').length;
    const kitsDisponiveis = Math.min(dispTelas, dispMags, dispChips);
    
    // Contagem de Manutenção
    const bordosManutencao = activeBordos.filter(b => b.status === 'Manutenção');
    const manutTelas = bordosManutencao.filter(b => b.tipo === 'Tela').length;
    const manutMags = bordosManutencao.filter(b => b.tipo === 'Mag').length;

    // Contagem de Sinistro
    const bordosSinistro = activeBordos.filter(b => b.status === 'Sinistro');
    const sinistroTelas = bordosSinistro.filter(b => b.tipo === 'Tela').length;
    const sinistroMags = bordosSinistro.filter(b => b.tipo === 'Mag').length;
    const sinistroChips = bordosSinistro.filter(b => b.tipo === 'Chip').length;

    // --- 3. Cálculos da Tabela de Equipamentos (Vínculos) ---
    const equipamentoMap = dbEquipamentos.reduce((acc, e) => { acc[e.id] = e; return acc; }, {});
    const groupCounts = {};
    GROUPS.forEach(g => groupCounts[g] = 0); // Inicializa todos os grupos com 0

    // Conta os registros de vínculo por grupo
    dbRegistros.forEach(reg => {
        const equipamento = equipamentoMap[reg.equipamentoId];
        if (equipamento && equipamento.grupo && GROUPS.includes(equipamento.grupo)) {
            groupCounts[equipamento.grupo]++;
        }
    });
    
    const totalEquipamentosCalc = dbRegistros.length;

    // --- 5. Helper de Renderização de Card ---
    const _renderStatCard = (title, value, iconClass, accent, details = null, onclick = null) => {
        const clickable = onclick ? ` onclick="${onclick}" role="button" tabindex="0"` : '';
        return `
            <div class="stat-card" style="--accent:${accent}"${clickable}>
                <div class="stat-card__top">
                    <span class="stat-card__icon"><i class="fas ${iconClass}"></i></span>
                    <div class="min-w-0">
                        <p class="stat-card__label">${title}</p>
                        <p class="stat-card__value">${value}</p>
                    </div>
                </div>
                ${details ? `<div class="stat-card__details">${details}</div>` : ''}
            </div>
        `;
    };

    // --- 6. Geração do HTML dos Cards ---
    
    // Rádios
    const cardHtmlRadios = `
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            ${_renderStatCard('Total Rádios', totalRadios, 'fa-broadcast-tower', '#2563eb')}
            ${_renderStatCard('Em Uso', radiosEmUso, 'fa-wifi', '#40800c')}
            ${_renderStatCard('Disponíveis', radiosDisponiveis, 'fa-check-circle', '#0ea5e9', null, 'showRadiosDisponiveis()')}
            ${_renderStatCard('Manutenção', radiosManutencao, 'fa-tools', '#d97706')}
            ${_renderStatCard('Sinistro', radiosSinistro, 'fa-exclamation-triangle', '#dc2626')}
        </div>
    `;
    
    // Bordos
    const cardHtmlBordos = `
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            ${_renderStatCard('Total Componentes', totalBordos, 'fa-memory', '#2563eb')}
            
            ${_renderStatCard('Kits em Uso', bordosEmUso, 'fa-microchip', '#40800c')}
            
            ${_renderStatCard('Kits Disponíveis', kitsDisponiveis, 'fa-boxes', '#0ea5e9')}
            
            ${_renderStatCard('Manutenção', manutTelas + manutMags, 'fa-tools', '#d97706', 
                `<span>Tela: ${manutTelas}</span><span>Mag: ${manutMags}</span>`)}
            ${_renderStatCard('Sinistro', sinistroTelas + sinistroMags + sinistroChips, 'fa-exclamation-triangle', '#dc2626', 
                `<span>Tela: ${sinistroTelas}</span><span>Mag: ${sinistroMags}</span><span>Chip: ${sinistroChips}</span>`)}
        </div>
    `;

    // --- 7. Geração do HTML das Tabelas ---

    // Tabela de Equipamentos
    const tableRowsEquipamentos = GROUPS.map(group => {
        const count = groupCounts[group] || 0;
        const pct = totalEquipamentosCalc ? Math.round((count / totalEquipamentosCalc) * 100) : 0;
        return `
            <tr>
                <td data-label="Grupo" class="font-semibold">${group}</td>
                <td data-label="Frotas">
                    <span class="inline-flex items-center gap-2 w-full justify-end md:justify-start">
                        <span class="num font-bold">${count}</span>
                        <span class="meter hidden md:block" style="width:120px;--accent:#40800c"><span class="meter__fill" style="width:${pct}%"></span></span>
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    const totalEquipamentos = dbRegistros.length;

    // Tabela de Bordos (Resumo por tipo/componente)
    const tableRowsBordos = TIPOS_BORDO.map(tipo => {
        const stats = bordoStats[tipo];
        return `
            <tr>
                <td data-label="Tipo" class="font-semibold">${tipo}</td>
                <td data-label="Total" class="num">${stats.Total}</td>
                <td data-label="Em uso" class="num">${stats['Em Uso']}</td>
                <td data-label="Disponível" class="num">${stats['Disponível']}</td>
                <td data-label="Manutenção" class="num">${stats['Manutenção']}</td>
                <td data-label="Sinistro" class="num">${stats['Sinistro']}</td>
            </tr>
        `;
    }).join('');

    // Helper de barras
    const _bars = (items) => items.length ? items.map(item => {
        const max = item.max || 1;
        const pct = Math.min(100, Math.round((item.value / max) * 100));
        return `
            <div>
                <div class="flex justify-between items-baseline text-xs mb-1.5 gap-3">
                    <span class="truncate" style="color:var(--txt-2);font-weight:600">${item.label}</span>
                    <span class="num font-bold" style="color:var(--txt)">${item.value}</span>
                </div>
                <div class="meter" style="--accent:${item.color}"><div class="meter__fill" style="width:${pct}%"></div></div>
            </div>
        `;
    }).join('') : '<p class="text-xs" style="color:var(--txt-3)">Sem dados para exibir.</p>';

    const gestorCount = {};
    dbRegistros.forEach(reg => {
        const eq = equipamentoMap[reg.equipamentoId];
        const gestor = (eq && eq.gestor) || 'Sem Gestor';
        gestorCount[gestor] = (gestorCount[gestor] || 0) + 1;
    });
    const topGestores = Object.entries(gestorCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const maxGestor = topGestores.length ? topGestores[0][1] : 1;

    // --- 8. Retorno do HTML Final ---
    return `
        <div class="lf-shell">
            <div class="page-head">
                <div>
                    <span class="page-head__eyebrow"><i class="fas fa-signal"></i> Visão geral</span>
                    <h1 class="page-head__title">Dashboard de Rádios e Frota</h1>
                    <p class="page-head__sub">${totalRadios} rádios ativos · ${totalBordos} componentes de bordo · ${totalEquipamentos} vínculos</p>
                </div>
                <button onclick="showRadioAmadorModal()" class="btn btn--secondary btn--sm">
                    <i class="fas fa-broadcast-tower"></i><span>Rádio Amador</span>
                </button>
            </div>

            <h2 class="section-title"><i class="fas fa-broadcast-tower"></i> Rádios</h2>
            <div class="mb-8">${cardHtmlRadios}</div>

            <h2 class="section-title"><i class="fas fa-microchip"></i> Bordos</h2>
            <div class="mb-8">${cardHtmlBordos}</div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div class="card card--pad">
                    <h3 class="panel-title"><i class="fas fa-boxes"></i> Equipamentos com vínculo ativo
                        <span class="badge badge--muted ml-auto">${totalEquipamentos}</span>
                    </h3>
                    <div class="table-scroll">
                        <table class="data-table">
                            <thead><tr><th>Grupo</th><th>Frotas vinculadas</th></tr></thead>
                            <tbody>${tableRowsEquipamentos}</tbody>
                        </table>
                    </div>
                </div>

                <div class="card card--pad">
                    <h3 class="panel-title"><i class="fas fa-memory"></i> Resumo de componentes de bordo
                        <span class="badge badge--muted ml-auto">${totalBordos}</span>
                    </h3>
                    <div class="table-scroll">
                        <table class="data-table">
                            <thead><tr><th>Tipo</th><th>Total</th><th>Uso</th><th>Disp.</th><th>Manut.</th><th>Sinist.</th></tr></thead>
                            <tbody>${tableRowsBordos}</tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">
                <div class="card card--pad">
                    <h3 class="panel-title"><i class="fas fa-broadcast-tower"></i> Distribuição de rádios</h3>
                    <div class="space-y-3.5">
                        ${_bars([
                            { label: 'Total', value: totalRadios, color: '#2563eb', max: totalRadios || 1 },
                            { label: 'Em uso', value: radiosEmUso, color: '#40800c', max: totalRadios || 1 },
                            { label: 'Disponíveis', value: radiosDisponiveis, color: '#0ea5e9', max: totalRadios || 1 },
                            { label: 'Manutenção', value: radiosManutencao, color: '#d97706', max: totalRadios || 1 },
                            { label: 'Sinistro', value: radiosSinistro, color: '#dc2626', max: totalRadios || 1 }
                        ])}
                    </div>
                </div>

                <div class="card card--pad">
                    <h3 class="panel-title"><i class="fas fa-microchip"></i> Kits de bordo</h3>
                    <div class="space-y-3.5">
                        ${_bars([
                            { label: 'Total de kits', value: totalKits, color: '#2563eb', max: totalKits || 1 },
                            { label: 'Kits em uso', value: bordosEmUso, color: '#40800c', max: totalKits || 1 },
                            { label: 'Kits disponíveis', value: kitsDisponiveis, color: '#0ea5e9', max: totalKits || 1 }
                        ])}
                    </div>
                </div>

                <div class="card card--pad">
                    <h3 class="panel-title"><i class="fas fa-users"></i> Equipes com mais instalações</h3>
                    <div class="space-y-3.5">
                        ${_bars(topGestores.map(([gestor, count]) => ({ label: gestor, value: count, color: '#40800c', max: maxGestor })))}
                    </div>
                </div>
            </div>
        </div>
    `;
}


//Fim da função dos Dashboards**

function renderCadastro() {
    const tabs = [
        { id: 'radio', name: 'Rádios', icon: 'fa-broadcast-tower' },
        { id: 'equipamento', name: 'Equipamentos', icon: 'fa-tractor' },
        { id: 'bordos', name: 'Bordos', icon: 'fa-microchip' },
        { id: 'geral', name: 'Vínculos', icon: 'fa-link' }
    ];
    
    const tabNav = tabs.map(tab => `
        <button data-tab="${tab.id}" class="tab ${currentCadastroTab === tab.id ? 'is-active' : ''}">
            <i class="fas ${tab.icon}"></i><span>${tab.name}</span>
        </button>
    `).join('');

    let content = '';
    switch (currentCadastroTab) {
        case 'radio': content = renderCadastroRadio(); break;
        case 'equipamento': content = renderCadastroEquipamento(); break;
        case 'bordos': content = renderCadastroBordos(); break;
        case 'geral': content = renderCadastroGeral(); break;
    }

    return `
        <div class="lf-shell">
            <div class="page-head">
                <div>
                    <span class="page-head__eyebrow"><i class="fas fa-pen-to-square"></i> Gestão de dados</span>
                    <h1 class="page-head__title">Cadastro</h1>
                    <p class="page-head__sub">Rádios, equipamentos, componentes de bordo e vínculos</p>
                </div>
            </div>
            <div class="card">
                <div id="cadastro-nav" class="tabs px-2 md:px-4">${tabNav}</div>
                <div class="p-4 md:p-6">${content}</div>
            </div>
        </div>
    `;
}

function renderCadastroRadio() {
    // Conta apenas os ativos para o título
    const activeRadiosCount = dbRadios.filter(r => r.ativo !== false).length;

    // Filtra por termo de busca em todos os rádios (ativos e inativos)
    const filteredRadios = dbRadios.filter(r =>	
        (r.serie || '').toLowerCase().includes(radioSearch) ||	
        (r.modelo || '').toLowerCase().includes(radioSearch) ||
        (r.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(radioSearch)
    );

    // Ordena: Ativos primeiro, Inativos por último. Dentro de cada grupo, ordena por série.
    filteredRadios.sort((a, b) => {
        const aAtivo = a.ativo !== false;
        const bAtivo = b.ativo !== false;

        if (aAtivo && !bAtivo) return -1; // Ativo vem antes do inativo
        if (!aAtivo && bAtivo) return 1;  // Inativo vem depois do ativo
        
        // Se o status for o mesmo (ambos ativos ou ambos inativos), ordena por série.
        return (a.serie || '').localeCompare(b.serie || '');
    });
    
    const totalRadioPages = Math.ceil(filteredRadios.length / PAGE_SIZE);
    radioPage = Math.min(radioPage, totalRadioPages) || 1;
    const paginatedRadios = filteredRadios.slice((radioPage - 1) * PAGE_SIZE, radioPage * PAGE_SIZE);

    // 🌟 ATUALIZADO: Opções de Status com Sinistro
    const statusOptions = DISPONIBLE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('');

    const tableRows = paginatedRadios.map(r => {
        const isAtivo = r.ativo !== false;
        const rowClass = isAtivo ? '' : 'row-inactive';
        const statusText = isAtivo ? r.status || 'Disponível' : 'INATIVO';
        // 🌟 ATUALIZADO: Classe para Sinistro
        const statusClass = !isAtivo ? 'badge--danger' : (r.status === 'Disponível' ? 'badge--ok' : (r.status === 'Manutenção' ? 'badge--warn' : (r.status === 'Sinistro' ? 'badge--danger' : 'badge--info')));
        
        // Usa text-gray-700 para manter a cor do texto do item inativo em cinza, 
        // apenas a coluna do status e a linha de fundo muda.
        return `
            <tr class="${rowClass}">
                <td class="num">${r.serie}</td>
                <td>${r.modelo}</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button onclick="loadRadioForEdit('${r.id}')" class="act-btn" title="Editar Rádio">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${(() => {
                        const actionText = isAtivo ? 'INATIVAR' : 'ATIVAR';
                        // Invertendo a lógica da cor do ícone no toggle: se ATIVO, mostra o ícone verde, se INATIVO, mostra o ícone cinza.
                        const iconClass = isAtivo ? 'fa-toggle-on text-green-main' : 'fa-toggle-off text-gray-500 dark:text-gray-400'; 
                        const btnClass = isAtivo ? 'hover:text-red-900' : 'hover:text-green-main';
                        const title = isAtivo ? 'Inativar Rádio' : 'Ativar Rádio';
                        return `
                        <button onclick="showConfirmModal('Confirmar ${actionText}ÇÃO', 'Deseja realmente ${actionText} o Rádio ${r.serie}?', () => toggleRecordAtivo('radios', '${r.id}'))" class="act-btn" title="${title}">
                            <i class="fas ${iconClass} fa-lg"></i>
                        </button>
                        `;
                    })()}
                </td>
            </tr>
        `;
    }).join('');

    let radioPaginator = '';
    if (filteredRadios.length > PAGE_SIZE) {
        radioPaginator = '<div class="pager">';
        // CORREÇÃO: Chama a função global
        radioPaginator += `<button ${radioPage === 1 ? 'disabled' : ''} onclick="setRadioPage(-1)" class="btn btn--secondary btn--sm">Anterior</button>`;
        radioPaginator += `<span class="pager__info">Pág ${radioPage} de ${totalRadioPages}</span>`;
        // CORREÇÃO: Chama a função global
        radioPaginator += `<button ${radioPage === totalRadioPages ? 'disabled' : ''} onclick="setRadioPage(1)" class="btn btn--secondary btn--sm">Próxima</button>`;
        radioPaginator += '</div>';
    }

    return `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-1 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700">
                <h4 class="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Novo/Editar Rádio</h4>
                <form id="form-radio" class="space-y-4">
                    <input type="hidden" id="radio-id">
                    <div>
                        <label for="radio-serie" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Número de Série <span class="text-red-500">*</span></label>
                        <input type="text" id="radio-serie" required placeholder="Ex: 112sar234s"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="radio-modelo" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Modelo de Rádio <span class="text-red-500">*</span></label>
                        <input type="text" id="radio-modelo" required placeholder="Ex: EM200"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="radio-status" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                        <select id="radio-status" class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            ${statusOptions}
                            <option value="Em Uso" disabled>Em Uso (automático)</option>
                        </select>
                    </div>
                    <div class="flex space-x-3">
                        <button type="submit" class="btn btn--primary flex-1">
                            <i class="fas fa-save mr-2"></i> Salvar
                        </button>
                        <button type="button" onclick="document.getElementById('form-radio').reset(); document.getElementById('radio-id').value='';" class="btn btn--secondary">
                            <i class="fas fa-redo"></i>
                        </button>
                    </div>
                </form>
                <div class="flex justify-between items-center mt-4">
                    <input type="file" id="radio-import-file" accept=".csv, .xlsx, .xls" class="hidden" onchange="handleImport('radios', event)">
                    <button onclick="document.getElementById('radio-import-file').click()" class="btn btn--secondary flex-1">
                        <i class="fas fa-upload mr-2"></i> Importar (csv, xlsx)
                    </button>
                    <button onclick="showModal('Instruções de Importação - Rádio', window.RADIO_IMPORT_INFO, 'info')" class="icon-btn" title="Instruções de arquivo">
                        <i class="fas fa-info-circle"></i>
                    </button>
                </div>
            </div>

            <div class="lg:col-span-2">
                <div class="panel-head">
                    <h4 class="panel-title">Rádios Cadastrados <span class="badge badge--muted">${activeRadiosCount} ativos</span></h4>
                    <input type="text" id="radio-search-input" value="${radioSearch}"	
                        oninput="handleSearchInput(this, 'radioSearch', 1)"	
                        placeholder="Buscar Série ou Modelo..."	
                        class="w-full sm:max-w-xs">
                </div>
                <div class="table-scroll">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Série</th>
                                <th>Modelo</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>${paginatedRadios.map(r => {
                            const isAtivo = r.ativo !== false;
                            const rowClass = isAtivo ? '' : 'row-inactive';
                            const statusText = isAtivo ? r.status || 'Disponível' : 'INATIVO';
                            const statusClass = !isAtivo ? 'badge--danger' : (r.status === 'Disponível' ? 'badge--ok' : (r.status === 'Manutenção' ? 'badge--warn' : (r.status === 'Sinistro' ? 'badge--danger' : 'badge--info')));
                            return `
                                <tr class="${rowClass}">
                                    <td class="num">${r.serie}</td>
                                    <td>${r.modelo}</td>
                                    <td><span class="badge ${statusClass}">${statusText}</span></td>
                                    <td>
                                        <button onclick="loadRadioForEdit('${r.id}')" class="act-btn" title="Editar Rádio">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        ${(() => {
                                            const actionText = isAtivo ? 'INATIVAR' : 'ATIVAR';
                                            const iconClass = isAtivo ? 'fa-toggle-on text-green-main' : 'fa-toggle-off text-gray-500 dark:text-gray-400';
                                            const btnClass = isAtivo ? 'hover:text-red-900' : 'hover:text-green-main';
                                            const title = isAtivo ? 'Inativar Rádio' : 'Ativar Rádio';
                                            return `
                                            <button onclick="showConfirmModal('Confirmar ${actionText}ÇÃO', 'Deseja realmente ${actionText} o Rádio ${r.serie}?', () => toggleRecordAtivo('radios', '${r.id}'))" class="act-btn" title="${title}">
                                                <i class="fas ${iconClass} fa-lg"></i>
                                            </button>
                                            `;
                                        })()}
                                    </td>
                                </tr>
                            `;
                        }).join('')}</tbody>
                    </table>
                </div>
                ${radioPaginator}
            </div>
        </div>
    `;
}

function renderCadastroEquipamento() {
    // Conta apenas os ativos para o título
    const activeEquipamentosCount = dbEquipamentos.filter(e => e.ativo !== false).length;

    // Filtra por termo de busca em todos os equipamentos (ativos e inativos)
    const filteredEquipamentos = dbEquipamentos.filter(e =>	
        (e.frota || '').toLowerCase().includes(equipamentoSearch) ||
        (e.grupo || '').toLowerCase().includes(equipamentoSearch) ||
        (e.modelo || '').toLowerCase().includes(equipamentoSearch) ||
        (e.subgrupo || '').toLowerCase().includes(equipamentoSearch) ||
        (e.codigo || '').toLowerCase().includes(equipamentoSearch) ||
        (e.gestor || '').toLowerCase().includes(equipamentoSearch)
    );

    // Ordena: Ativos primeiro, Inativos por último. Dentro de cada grupo, ordena por frota.
    filteredEquipamentos.sort((a, b) => {
        const aAtivo = a.ativo !== false;
        const bAtivo = b.ativo !== false;

        if (aAtivo && !bAtivo) return -1; // Ativo vem antes do inativo
        if (!aAtivo && bAtivo) return 1;  // Inativo vem depois do ativo

        // Se o status for o mesmo, ordena por frota
        return (a.frota || '').localeCompare(b.frota || '');
    });

    const totalEquipamentoPages = Math.ceil(filteredEquipamentos.length / PAGE_SIZE);
    equipamentoPage = Math.min(equipamentoPage, totalEquipamentoPages) || 1;
    const paginatedEquipamentos = filteredEquipamentos.slice((equipamentoPage - 1) * PAGE_SIZE, equipamentoPage * PAGE_SIZE);
    
    const tableRows = paginatedEquipamentos.map(e => {
        const isAtivo = e.ativo !== false;
        const rowClass = isAtivo ? '' : 'row-inactive';
        const frotaClass = isAtivo ? 'text-gray-700 dark:text-gray-300' : 'text-red-700 dark:text-red-400';
        
        // NOVO: Verifica se o equipamento JÁ está em algum registro
        const registro = dbRegistros.find(reg => reg.equipamentoId === e.id);
        const isLinked = !!registro;

        return `
            <tr class="${rowClass}">
                <td class="${frotaClass} num">${e.frota} ${isAtivo ? '' : '(INATIVO)'}</td>
                <td>${e.grupo}</td>
                <td>${e.modelo}</td>
                <td class="hidden md:table-cell">${e.subgrupo || 'N/A'}</td>
                <td class="hidden lg:table-cell">${e.gestor || 'N/A'}</td>
                <td>
                    <button onclick="loadEquipamentoForEdit('${e.id}')" class="act-btn" title="Editar Equipamento">
                        <i class="fas fa-edit"></i>
                    </button>
                    
                    ${(isAtivo && !isLinked) ? `
                        <button onclick="showVincularModal('${e.id}', 'radio')" 
                            class="text-green-main hover:text-green-700 p-1 rounded-full hover:bg-green-50/50 dark:hover:bg-gray-700" 
                            title="Iniciar Vínculo (Rádio ou Bordos)">
                            <i class="fas fa-link fa-lg"></i>
                        </button>
                    ` : (isAtivo && isLinked) ? `
                        <button onclick="updateState('cadastroTab', 'geral'); geralSearch = '${e.frota.toLowerCase()}'" 
                            class="text-blue-600 hover:text-blue-800 p-1 rounded-full hover:bg-blue-50/50 dark:hover:bg-gray-700" 
                            title="Gerenciar Vínculos na Aba Geral">
                            <i class="fas fa-layer-group fa-lg"></i>
                        </button>
                    ` : ''}
                    
                    ${(() => {
                        const actionText = isAtivo ? 'INATIVAR' : 'ATIVAR';
                        // Invertendo a lógica da cor do ícone no toggle
                        const iconClass = isAtivo ? 'fa-toggle-on text-green-main' : 'fa-toggle-off text-gray-500 dark:text-gray-400';
                        const btnClass = isAtivo ? 'hover:text-red-900' : 'hover:text-green-main';
                        const title = isAtivo ? 'Inativar Equipamento' : 'Ativar Equipamento';
                        return `
                        <button onclick="showConfirmModal('Confirmar ${actionText}ÇÃO', 'Deseja realmente ${actionText} o Equipamento ${e.frota}?', () => toggleRecordAtivo('equipamentos', '${e.id}'))" class="act-btn" title="${title}">
                            <i class="fas ${iconClass} fa-lg"></i>
                        </button>
                        `;
                    })()}
                </td>
            </tr>
        `;
    }).join('');
    
    const groupOptions = GROUPS.map(g => `<option value="${g}">${g}</option>`).join('');

    let equipamentoPaginator = '';
    if (filteredEquipamentos.length > PAGE_SIZE) {
        equipamentoPaginator = '<div class="pager">';
        // CORREÇÃO: Chama a função global
        equipamentoPaginator += `<button ${equipamentoPage === 1 ? 'disabled' : ''} onclick="setEquipamentoPage(-1)" class="btn btn--secondary btn--sm">Anterior</button>`;
        equipamentoPaginator += `<span class="pager__info">Pág ${equipamentoPage} de ${totalEquipamentoPages}</span>`;
        // CORREÇÃO: Chama a função global
        equipamentoPaginator += `<button ${equipamentoPage === totalEquipamentoPages ? 'disabled' : ''} onclick="setEquipamentoPage(1)" class="btn btn--secondary btn--sm">Próxima</button>`;
        equipamentoPaginator += '</div>';
    }

    return `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-1 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700">
                <h4 class="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Novo/Editar Equipamento</h4>
                <form id="form-equipamento" class="space-y-4">
                    <input type="hidden" id="equipamento-id">
                    <div>
                        <label for="equipamento-frota" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Frota <span class="text-red-500">*</span></label>
                        <input type="text" id="equipamento-frota" required placeholder="Ex: 123456"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="equipamento-grupo" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Grupo <span class="text-red-500">*</span></label>
                        <select id="equipamento-grupo" required
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            <option value="">Selecione o Grupo</option>
                            ${groupOptions}
                        </select>
                    </div>
                    <div>
                        <label for="equipamento-modelo" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Modelo do Equipamento <span class="text-red-500">*</span></label>
                        <input type="text" id="equipamento-modelo" required placeholder="Ex: Trator XYZ"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="equipamento-subgrupo" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Subgrupo <span class="text-red-500">*</span></label>
                        <input type="text" id="equipamento-subgrupo" required placeholder="Ex: Ferirrigação, Tratos Culturais"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="equipamento-gestor" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Gestor (Opcional)</label>
                        <input type="text" id="equipamento-gestor" placeholder="Ex: João da Silva"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div class="flex space-x-3">
                        <button type="submit" id="btn-equipamento-salvar" class="btn btn--primary flex-1">
                            <i class="fas fa-save mr-2"></i> Salvar
                        </button>
                        <button type="button" id="btn-equipamento-excluir" onclick="deleteEquipamento()" class="w-1/3 flex justify-center py-2 px-3 border border-transparent text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 shadow-md">
                            <i class="fas fa-trash mr-2"></i> Excluir
                        </button>
                        <button type="button" onclick="document.getElementById('form-equipamento').reset(); document.getElementById('equipamento-id').value='';" class="btn btn--secondary">
                            <i class="fas fa-redo"></i>
                        </button>
                    </div>
                </form>
                <div class="flex justify-between items-center mt-4">
                    <input type="file" id="equipamento-import-file" accept=".csv, .xlsx, .xls" class="hidden" onchange="handleImport('equipamentos', event)">
                    <button onclick="document.getElementById('equipamento-import-file').click()" class="btn btn--secondary flex-1">
                        <i class="fas fa-upload mr-2"></i> Importar (csv, xlsx)
                    </button>
                    <button onclick="showModal('Instruções de Importação - Equipamento', window.EQUIPAMENTO_IMPORT_INFO, 'info')" class="icon-btn" title="Instruções de arquivo">
                        <i class="fas fa-info-circle"></i>
                    </button>
                </div>
            </div>
            <div class="lg:col-span-2">
                <div class="panel-head">
                    <h4 class="panel-title">Equipamentos Cadastrados <span class="badge badge--muted">${activeEquipamentosCount} ativos</span></h4>
                    <input type="text" id="equip-search-input" value="${equipamentoSearch}"	
                        oninput="handleSearchInput(this, 'equipamentoSearch', 1)"	
                        placeholder="Buscar Frota, Grupo ou Modelo..."	
                        class="w-full sm:max-w-xs">
                </div>
                <div class="table-scroll">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Frota</th>
                                <th>Grupo</th>
                                <th>Modelo</th>
                                <th class="hidden md:table-cell">Subgrupo</th>
                                <th class="hidden lg:table-cell">Gestor</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>${paginatedEquipamentos.map(e => {
                            const isAtivo = e.ativo !== false;
                            const rowClass = isAtivo ? '' : 'row-inactive';
                            const frotaClass = isAtivo ? 'text-gray-700 dark:text-gray-300' : 'text-red-700 dark:text-red-400';
                            
                            // NOVO: Verifica se o equipamento JÁ está em algum registro
                            const registro = dbRegistros.find(reg => reg.equipamentoId === e.id);
                            const isLinked = !!registro;

                            return `
                                <tr class="${rowClass}">
                                    <td class="${frotaClass} num">${e.frota} ${isAtivo ? '' : '(INATIVO)'}</td>
                                    <td>${e.grupo}</td>
                                    <td>${e.modelo}</td>
                                    <td class="hidden md:table-cell">${e.subgrupo || 'N/A'}</td>
                                    <td class="hidden lg:table-cell">${e.gestor || 'N/A'}</td>
                                    <td>
                                        <button onclick="loadEquipamentoForEdit('${e.id}')" class="act-btn" title="Editar Equipamento">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        
                                        ${(isAtivo && !isLinked) ? `
                                            <button onclick="showVincularModal('${e.id}', 'radio')" 
                                                class="text-green-main hover:text-green-700 p-1 rounded-full hover:bg-green-50/50 dark:hover:bg-gray-700" 
                                                title="Iniciar Vínculo (Rádio ou Bordos)">
                                                <i class="fas fa-link fa-lg"></i>
                                            </button>
                                        ` : (isAtivo && isLinked) ? `
                                            <button onclick="updateState('cadastroTab', 'geral'); geralSearch = '${e.frota.toLowerCase()}'" 
                                                class="text-blue-600 hover:text-blue-800 p-1 rounded-full hover:bg-blue-50/50 dark:hover:bg-gray-700" 
                                                title="Gerenciar Vínculos na Aba Geral">
                                                <i class="fas fa-layer-group fa-lg"></i>
                                            </button>
                                        ` : ''}
                                        
                                        ${(() => {
                                            const actionText = isAtivo ? 'INATIVAR' : 'ATIVAR';
                                            const iconClass = isAtivo ? 'fa-toggle-on text-green-main' : 'fa-toggle-off text-gray-500 dark:text-gray-400';
                                            const btnClass = isAtivo ? 'hover:text-red-900' : 'hover:text-green-main';
                                            const title = isAtivo ? 'Inativar Equipamento' : 'Ativar Equipamento';
                                            return `
                                            <button onclick="showConfirmModal('Confirmar ${actionText}ÇÃO', 'Deseja realmente ${actionText} o Equipamento ${e.frota}?', () => toggleRecordAtivo('equipamentos', '${e.id}'))" class="act-btn" title="${title}">
                                                <i class="fas ${iconClass} fa-lg"></i>
                                            </button>
                                            `;
                                        })()}
                                    </td>
                                </tr>
                            `;
                        }).join('')}</tbody>
                    </table>
                </div>
                ${equipamentoPaginator}
            </div>
        </div>
    `;
}
// 🌟 NOVO: Função de Renderização da aba Bordos
function renderCadastroBordos() {
    // Conta apenas os ativos para o título
    const activeBordosCount = dbBordos.filter(b => b.ativo !== false).length;

    // Filtra por termo de busca
    const filteredBordos = dbBordos.filter(b =>	
        (b.numeroSerie || '').toLowerCase().includes(bordosSearch) ||
        (b.modelo || '').toLowerCase().includes(bordosSearch) ||
        (b.tipo || '').toLowerCase().includes(bordosSearch) ||
        (b.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(bordosSearch)
    );

    // FIX para o erro: Uncaught TypeError: Cannot read properties of undefined (reading 'localeCompare')
    // Garantimos que 'a' e 'b' não são undefined e que as propriedades existem antes de comparar.
    filteredBordos.sort((a, b) => {
        // Se a ou b for undefined/null, forçamos para o final da lista (ou mantemos a ordem)
        if (!a || !a.ativo) return 1;
        if (!b || !b.ativo) return -1;
        
        const aAtivo = a.ativo !== false;
        const bAtivo = b.ativo !== false;

        if (aAtivo && !bAtivo) return -1; 
        if (!aAtivo && bAtivo) return 1; 
        
        // Ordena por Tipo (se existir)
        const tipoA = a.tipo || '';
        const tipoB = b.tipo || '';
        if (tipoA !== tipoB) return tipoA.localeCompare(tipoB);
        
        // Depois por Série (se existir)
        const serieA = a.numeroSerie || '';
        const serieB = b.numeroSerie || '';
        return serieA.localeCompare(serieB);
    });
    
    const totalBordosPages = Math.ceil(filteredBordos.length / PAGE_SIZE);
    bordosPage = Math.min(bordosPage, totalBordosPages) || 1;
    const paginatedBordos = filteredBordos.slice((bordosPage - 1) * PAGE_SIZE, bordosPage * PAGE_SIZE);

    // 🌟 ATUALIZADO: Opções de Status com Sinistro
    const statusOptions = DISPONIBLE_STATUSES.map(s => `<option value="${s}">${s}</option>`).join('');

    const tableRows = paginatedBordos.map(b => {
        const isAtivo = b.ativo !== false;
        const rowClass = isAtivo ? '' : 'row-inactive';
        const statusText = isAtivo ? b.status || 'Disponível' : 'INATIVO';
        // 🌟 ATUALIZADO: Classe para Sinistro
        const statusClass = !isAtivo ? 'badge--danger' : (b.status === 'Disponível' ? 'badge--ok' : (b.status === 'Manutenção' ? 'badge--warn' : (b.status === 'Sinistro' ? 'badge--danger' : 'badge--info')));
        
        const tipoClass = b.tipo === 'Tela' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' 
                        : b.tipo === 'Mag' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' 
                        : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300'; // Chip
        
        return `
            <tr class="${rowClass}">
                <td>
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tipoClass}">${b.tipo}</span>
                </td>
                <td class="num">${b.numeroSerie}</td>
                <td>${b.modelo}</td>
                <td><span class="badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button onclick="loadBordoForEdit('${b.id}')" class="act-btn" title="Editar Bordo">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${(() => {
                        const actionText = isAtivo ? 'INATIVAR' : 'ATIVAR';
                        const iconClass = isAtivo ? 'fa-toggle-on text-green-main' : 'fa-toggle-off text-gray-500 dark:text-gray-400';
                        const btnClass = isAtivo ? 'hover:text-red-900' : 'hover:text-green-main';
                        const title = isAtivo ? 'Inativar Bordo' : 'Ativar Bordo';
                        return `
                        <button onclick="showConfirmModal('Confirmar ${actionText}ÇÃO', 'Deseja realmente ${actionText} o Bordo ${b.numeroSerie} (${b.tipo})?', () => toggleRecordAtivo('bordos', '${b.id}'))" class="act-btn" title="${title}">
                            <i class="fas ${iconClass} fa-lg"></i>
                        </button>
                        `;
                    })()}
                </td>
            </tr>
        `;
    }).join('');

    let bordosPaginator = '';
    if (filteredBordos.length > PAGE_SIZE) {
        bordosPaginator = '<div class="pager">';
        bordosPaginator += `<button ${bordosPage === 1 ? 'disabled' : ''} onclick="setBordosPage(-1)" class="btn btn--secondary btn--sm">Anterior</button>`;
        bordosPaginator += `<span class="pager__info">Pág ${bordosPage} de ${totalBordosPages}</span>`;
        bordosPaginator += `<button ${bordosPage === totalBordosPages ? 'disabled' : ''} onclick="setBordosPage(1)" class="btn btn--secondary btn--sm">Próxima</button>`;
        bordosPaginator += '</div>';
    }

    const tipoOptions = TIPOS_BORDO.map(t => `<option value="${t}">${t}</option>`).join('');

    return `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-1 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700">
                <h4 class="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Novo/Editar Item de Bordo</h4>
                <form id="form-bordos" class="space-y-4">
                    <input type="hidden" id="bordo-id">
                    <div>
                        <label for="bordo-tipo" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Tipo de Bordo <span class="text-red-500">*</span></label>
                        <select id="bordo-tipo" required
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            <option value="">Selecione o Tipo</option>
                            ${tipoOptions}
                        </select>
                    </div>
                    <div>
                        <label for="bordo-serie" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Número de Série <span class="text-red-500">*</span></label>
                        <input type="text" id="bordo-serie" required placeholder="Ex: TEL123456"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="bordo-modelo" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Modelo <span class="text-red-500">*</span></label>
                        <input type="text" id="bordo-modelo" required placeholder="Ex: Vbox 3"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="bordo-status" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                        <select id="bordo-status" class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            ${statusOptions}
                            <option value="Em Uso" disabled>Em Uso (automático)</option>
                        </select>
                    </div>
                    <div class="flex space-x-3">
                        <button type="submit" class="btn btn--primary flex-1">
                            <i class="fas fa-save mr-2"></i> Salvar
                        </button>
                        <button type="button" onclick="document.getElementById('form-bordos').reset(); document.getElementById('bordo-id').value='';" class="btn btn--secondary">
                            <i class="fas fa-redo"></i>
                        </button>
                    </div>
                </form>
                <div class="flex justify-between items-center mt-4">
                    <input type="file" id="bordos-import-file" accept=".csv, .xlsx, .xls" class="hidden" onchange="handleImport('bordos', event)">
                    <button onclick="document.getElementById('bordos-import-file').click()" class="btn btn--secondary flex-1">
                        <i class="fas fa-upload mr-2"></i> Importar (csv, xlsx)
                    </button>
                    <button onclick="showModal('Instruções de Importação - Bordos', window.BORDO_IMPORT_INFO, 'info')" class="icon-btn" title="Instruções de arquivo">
                        <i class="fas fa-info-circle"></i>
                    </button>
                </div>
            </div>

            <div class="lg:col-span-2">
                <div class="panel-head">
                    <h4 class="panel-title">Itens de Bordo Cadastrados <span class="badge badge--muted">${activeBordosCount} ativos</span></h4>
                    <input type="text" id="bordos-search-input" value="${bordosSearch}"	
                        oninput="handleSearchInput(this, 'bordosSearch', 1)"	
                        placeholder="Buscar Tipo, Série ou Modelo..."	
                        class="w-full sm:max-w-xs">
                </div>
                <div class="table-scroll">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Tipo</th>
                                <th>Série</th>
                                <th>Modelo</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>${paginatedBordos.map(b => {
                            const isAtivo = b.ativo !== false;
                            const rowClass = isAtivo ? '' : 'row-inactive';
                            const statusText = isAtivo ? b.status || 'Disponível' : 'INATIVO';
                            const statusClass = !isAtivo ? 'badge--danger' : (b.status === 'Disponível' ? 'badge--ok' : (b.status === 'Manutenção' ? 'badge--warn' : (b.status === 'Sinistro' ? 'badge--danger' : 'badge--info')));
                            
                            const tipoClass = b.tipo === 'Tela' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' 
                                            : b.tipo === 'Mag' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' 
                                            : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300'; // Chip
                            
                            return `
                                <tr class="${rowClass}">
                                    <td>
                                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${tipoClass}">${b.tipo}</span>
                                    </td>
                                    <td class="num">${b.numeroSerie}</td>
                                    <td>${b.modelo}</td>
                                    <td><span class="badge ${statusClass}">${statusText}</span></td>
                                    <td>
                                        <button onclick="loadBordoForEdit('${b.id}')" class="act-btn" title="Editar Bordo">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        ${(() => {
                                            const actionText = isAtivo ? 'INATIVAR' : 'ATIVAR';
                                            const iconClass = isAtivo ? 'fa-toggle-on text-green-main' : 'fa-toggle-off text-gray-500 dark:text-gray-400';
                                            const btnClass = isAtivo ? 'hover:text-red-900' : 'hover:text-green-main';
                                            const title = isAtivo ? 'Inativar Bordo' : 'Ativar Bordo';
                                            return `
                                            <button onclick="showConfirmModal('Confirmar ${actionText}ÇÃO', 'Deseja realmente ${actionText} o Bordo ${b.numeroSerie} (${b.tipo})?', () => toggleRecordAtivo('bordos', '${b.id}'))" class="act-btn" title="${title}">
                                                <i class="fas ${iconClass} fa-lg"></i>
                                            </button>
                                            `;
                                        })()}
                                    </td>
                                </tr>
                            `;
                        }).join('')}</tbody>
                    </table>
                </div>
                ${bordosPaginator}
            </div>
        </div>
    `;
}


function renderCadastroGeral() {
    const radioMap = dbRadios.reduce((acc, r) => { acc[r.id] = r; return acc; }, {});
    const equipamentoMap = dbEquipamentos.reduce((acc, e) => { acc[e.id] = e; return acc; }, {});
    // 🌟 NOVO: Mapa de Bordos
    const bordoMap = dbBordos.reduce((acc, b) => { acc[b.id] = b; return acc; }, {});
    
    // Filtra equipamentos ativos e disponíveis (sem vínculos)
    const availableEquipamentos = dbEquipamentos.filter(e =>	
        e.ativo !== false &&	
        !dbRegistros.some(reg => reg.equipamentoId === e.id) 
    );
    
    // NOVO: Filtrar Rádios e Bordos disponíveis para o formulário no lado esquerdo (Criação de Novo Vínculo)
    const availableRadios = dbRadios.filter(r =>	
        r.ativo !== false &&	
        r.status === 'Disponível' &&	
        !dbRegistros.some(reg => reg.radioId === r.id)	
    );
    const availableBordos = dbBordos.filter(b => 
        b.ativo !== false &&
        b.status === 'Disponível' &&
        !dbRegistros.some(reg => reg.telaId === b.id || reg.magId === b.id || reg.chipId === b.id)
    );
    
    const bordosPorTipo = availableBordos.reduce((acc, b) => {
        acc[b.tipo] = acc[b.tipo] || [];
        acc[b.tipo].push(b);
        return acc;
    }, {});

    const getBordoOptions = (tipo) => {
        const bordos = bordosPorTipo[tipo] || [];
        return bordos
            .map(b => `<option value="${b.id}">${b.numeroSerie} (${b.modelo})</option>`)
            .join('');
    };

    const radioOptions = availableRadios
        .map(r => `<option value="${r.id}">${r.serie} (${r.modelo})</option>`)
        .join('');
    const frotaOptions = availableEquipamentos
        .map(e => `<option value="${e.id}">${e.frota}</option>`)
        .join('');
    
    // Filtragem de Registros Ativos
    const filteredRegistros = dbRegistros.filter(reg => {
        const r = radioMap[reg.radioId] || {};
        const e = equipamentoMap[reg.equipamentoId] || {};
        const t = bordoMap[reg.telaId] || {};
        const m = bordoMap[reg.magId] || {};
        const c = bordoMap[reg.chipId] || {};
        const search = geralSearch.toLowerCase();
        
        return (
            (e.codigo || reg.codigo || '').toLowerCase().includes(search) ||
            (r.serie || '').toLowerCase().includes(search) ||
            (r.modelo || '').toLowerCase().includes(search) ||
            (e.frota || '').toLowerCase().includes(search) ||
            (e.grupo || '').toLowerCase().includes(search) ||
            (e.gestor || '').toLowerCase().includes(search) ||
            (t.numeroSerie || '').toLowerCase().includes(search) ||
            (m.numeroSerie || '').toLowerCase().includes(search) ||
            (c.numeroSerie || '').toLowerCase().includes(search)
        );
    });

    const totalGeralPages = Math.ceil(filteredRegistros.length / PAGE_SIZE);
    geralPage = Math.min(geralPage, totalGeralPages) || 1;
    const paginatedRegistros = filteredRegistros.slice((geralPage - 1) * PAGE_SIZE, geralPage * PAGE_SIZE);
    
    const tableRows = paginatedRegistros.map(reg => {
        const r = radioMap[reg.radioId] || { id: null, serie: 'N/A', modelo: 'N/A' };
        const e = equipamentoMap[reg.equipamentoId] || { id: null, frota: 'N/A', grupo: 'N/A', subgrupo: 'N/A', codigo: null, ativo: false };
        const t = bordoMap[reg.telaId] || { numeroSerie: 'N/A' };
        const m = bordoMap[reg.magId] || { numeroSerie: 'N/A' };
        const c = bordoMap[reg.chipId] || { numeroSerie: 'N/A' };
        
        const codigo = e.codigo || reg.codigo || 'N/A'; // Prioriza código do equipamento
        
        const isEquipamentoAtivo = e.ativo !== false;
        const temRadio = !!reg.radioId;
        const temBordos = reg.telaId || reg.magId || reg.chipId;
        
        const bordoStatus = temBordos 
            ? `<span class="text-green-600 font-semibold">Bordos OK</span>`
            : `<span class="text-gray-500 italic">Sem Bordos</span>`;
        
        // Classe de Linha (Equipamentos Inativos devem ter destaque)
        const rowClass = isEquipamentoAtivo ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b dark:border-gray-700' : 'hover:bg-red-50 dark:hover:bg-red-900/10 border-b dark:border-gray-700 opacity-60 italic';
        const frotaDisplay = isEquipamentoAtivo ? e.frota : `${e.frota} (INATIVO)`;
        
        // LÓGICA DE BOTÕES DINÂMICOS
        
        // Botão Rádio
        const radioButtonText = temRadio ? 'Desvincular Rádio' : 'Vincular Rádio';
        const radioButtonClass = temRadio ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-green-main text-white hover:bg-green-700';
        const radioButtonAction = temRadio 
            ? `showConfirmModal('Desvincular Rádio', 'Deseja desvincular o Rádio ${r.serie} da Frota ${e.frota}?', () => deleteLink('${reg.id}', 'radio'))`
            : `showVincularModal('${reg.equipamentoId}', 'radio')`; 
        
        // Botão Bordos
        const bordosButtonText = temBordos ? 'Substituir Bordo' : 'Vincular Bordos';
        const bordosButtonClass = temBordos ? 'btn btn--secondary btn--sm' : 'btn btn--primary btn--sm';
        // Ação: Sempre abre o modal de substituição/vínculo para Bordos.
        const bordosButtonAction = `showVincularModal('${reg.equipamentoId}', 'bordos')`;

        // Desabilita as ações se o Equipamento estiver INATIVO
        const actionsDisabled = !isEquipamentoAtivo;
        const disabledClass = actionsDisabled ? 'opacity-50 cursor-not-allowed' : '';

        const actionsHtml = `
            <div class="flex flex-col space-y-1 w-full max-w-xs mx-auto">
                <button 
                    onclick="${actionsDisabled ? '' : radioButtonAction}" 
                    class="px-2 py-1 text-xs font-semibold rounded-lg shadow-sm transition-colors ${radioButtonClass} ${disabledClass}" 
                    title="${actionsDisabled ? 'Ações bloqueadas: Equipamento inativo' : radioButtonText}"
                    ${actionsDisabled ? 'disabled' : ''}>
                    <i class="fas fa-wifi"></i> ${radioButtonText}
                </button>
                <button 
                    onclick="${actionsDisabled ? '' : bordosButtonAction}" 
                    class="px-2 py-1 text-xs font-semibold rounded-lg shadow-sm transition-colors ${bordosButtonClass} ${disabledClass}"
                    title="${actionsDisabled ? 'Ações bloqueadas: Equipamento inativo' : bordosButtonText}"
                    ${actionsDisabled ? 'disabled' : ''}>
                    <i class="fas fa-microchip"></i> ${bordosButtonText}
                </button>
            </div>
        `;

        return `
            <tr class="${rowClass}">
                <td class="num">${codigo}</td>
                <td>${frotaDisplay}</td>
                <td>${r.serie !== 'N/A' ? r.serie : '<span class="text-gray-400">--</span>'}</td>
                <td class="hidden sm:table-cell">${e.grupo || '--'}</td>
                <td class="hidden md:table-cell num">${t.numeroSerie && t.numeroSerie !== 'N/A' ? t.numeroSerie : '<span class="text-gray-400">--</span>'}</td>
                <td class="hidden md:table-cell num">${m.numeroSerie && m.numeroSerie !== 'N/A' ? m.numeroSerie : '<span class="text-gray-400">--</span>'}</td>
                <td class="hidden md:table-cell num">${c.numeroSerie && c.numeroSerie !== 'N/A' ? c.numeroSerie : '<span class="text-gray-400">--</span>'}</td>
                <td class="hidden lg:table-cell">${e.gestor && e.gestor !== 'Sem Gestor' ? e.gestor : '<span class="text-gray-400">--</span>'}</td>
                <td>
                    ${actionsHtml}
                </td>
            </tr>
        `;
    }).join('');

    let geralPaginator = '';
    if (filteredRegistros.length > PAGE_SIZE) {
        geralPaginator = '<div class="pager">';
        // CORREÇÃO: Chama a função global
        geralPaginator += `<button ${geralPage === 1 ? 'disabled' : ''} onclick="setGeralPage(-1)" class="btn btn--secondary btn--sm">Anterior</button>`;
        geralPaginator += `<span class="pager__info">Pág ${geralPage} de ${totalGeralPages}</span>`;
        // CORREÇÃO: Chama a função global
        geralPaginator += `<button ${geralPage === totalGeralPages ? 'disabled' : ''} onclick="setGeralPage(1)" class="btn btn--secondary btn--sm">Próxima</button>`;
        geralPaginator += '</div>';
    }


    return `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-1 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700">
                <h4 class="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 flex items-center">
                    <i class="fas fa-plus-circle mr-2 text-green-main"></i> Novo Vínculo (Rádio ou Bordos)
                </h4>
                <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">Para iniciar um novo registro, selecione a Frota, o Rádio e/ou os Bordos. O Código será gerado se a Frota ainda não tiver um.</p>
                
                <form id="form-geral" class="space-y-4">
                    <div>
                        <label for="geral-equipamento-id" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Frota (Equipamento) <span class="text-red-500">*</span></label>
                        <select id="geral-equipamento-id" required class="tom-select-equipamento mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            <option value="">Selecione a Frota</option>
                            ${frotaOptions}
                        </select>
                    </div>
                    
                    <div id="equipamento-info" class="space-y-2 text-sm p-3 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700">
                        <p class="text-gray-700 dark:text-gray-300"><span class="font-semibold">Grupo:</span> <span id="info-grupo">N/A</span></p>
                        <p class="text-gray-700 dark:text-gray-300"><span class="font-semibold">Subgrupo:</span> <span id="info-subgrupo">N/A</span></p>	
                        <p class="text-gray-700 dark:text-gray-300"><span class="font-semibold">Gestor:</span> <span id="info-gestor">N/A</span></p>
                        <p class="text-gray-700 dark:text-gray-300"><span class="font-semibold">Código:</span> <span id="info-codigo">N/A</span></p>
                    </div>

                    <h5 class="text-md font-semibold text-gray-800 dark:text-gray-100 border-b pb-1 mb-2 mt-4 flex items-center">
                        <i class="fas fa-wifi mr-2" style="color:var(--brand)"></i> Componentes (Ao menos um é obrigatório)
                    </h5>
                    
                    <div>
                        <label for="geral-radio-id" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Rádio (Opcional)</label>
                        <select id="geral-radio-id" class="tom-select-radio-novo mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            <option value="">Selecione um Rádio Disponível (Série/Modelo)</option>
                            ${radioOptions}
                        </select>
                    </div>
                    
                    <div class="space-y-2 p-3 border border-gray-300 dark:border-gray-600 rounded-lg">
                        <p class="text-xs text-red-500 dark:text-red-400 font-semibold">
                            Selecione os 3 Bordos para formar o Kit (Opcional). Se um for selecionado, todos são obrigatórios.
                        </p>
                        <div>
                            <label for="geral-tela-id" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Tela</label>
                            <select id="geral-tela-id" class="bordo-select mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                                <option value="">Selecione a Tela Disponível</option>
                                ${getBordoOptions('Tela')}
                            </select>
                        </div>
                        <div>
                            <label for="geral-mag-id" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Mag</label>
                            <select id="geral-mag-id" class="bordo-select mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                                <option value="">Selecione o Mag Disponível</option>
                                ${getBordoOptions('Mag')}
                            </select>
                        </div>
                        <div>
                            <label for="geral-chip-id" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Chip</label>
                            <select id="geral-chip-id" class="bordo-select mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                                <option value="">Selecione o Chip Disponível</option>
                                ${getBordoOptions('Chip')}
                            </select>
                        </div>
                    </div>

                    <button type="submit" class="btn btn--primary btn--block">
                        <i class="fas fa-barcode mr-2"></i> Criar Novo Vínculo
                    </button>
                </form>
            </div>
            
            <div class="lg:col-span-2">
                <div class="panel-head">
                    <h4 class="panel-title">Vínculos ativos <span class="badge badge--muted">${dbRegistros.length}</span></h4>
                    <div class="panel-tools">
                        <input type="text" id="geral-search-input" value="${geralSearch}"	
                            oninput="handleSearchInput(this, 'geralSearch', 1)"	
                            placeholder="Buscar Código, Série ou Frota..."	
                            class="w-full sm:w-52">
                        <button
                            onclick="document.getElementById('geral-import-vinculos-file').click()"
                            class="btn btn--secondary btn--sm"
                            title="Importar planilha com vínculos em lote (Frota, Rádio, Tela, Mag, Chip). A importação SUBSTITUI todos os dados existentes.">
                            <i class="fas fa-file-import"></i>
                            <span class="hidden xl:inline">Importar</span>
                        </button>
                        <input type="file" id="geral-import-vinculos-file" accept=".csv,.xlsx,.xls" class="hidden" onchange="handleImportVinculos(event)">
                        <button
                            onclick="downloadModeloVinculos()"
                            class="btn btn--primary btn--sm"
                            title="Baixar planilha modelo para preenchimento">
                            <i class="fas fa-file-excel"></i>
                            <span class="hidden xl:inline">Modelo</span>
                        </button>
                        <button
                            onclick="showModal('Instruções — Importar Vínculos em Lote', window.VINCULO_IMPORT_INFO, 'info', 'max-w-4xl')"
                            class="btn btn--secondary btn--sm"
                            title="Ver instruções de importação">
                            <i class="fas fa-question-circle"></i>
                        </button>
                    </div>
                </div>
                <div class="table-scroll">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Frota</th>
                                <th>Série Rádio / Modelo</th>
                                <th class="hidden sm:table-cell">Grupo</th>
                                <th class="hidden md:table-cell">Tela / Modelo</th>
                                <th class="hidden md:table-cell">Mag / Modelo</th>
                                <th class="hidden md:table-cell">Chip</th>
                                <th class="hidden lg:table-cell">Gestor</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>${paginatedRegistros.map(reg => {
                            const r = radioMap[reg.radioId] || { id: null, serie: 'N/A', modelo: 'N/A' };
                            const e = equipamentoMap[reg.equipamentoId] || { id: null, frota: 'N/A', grupo: 'N/A', subgrupo: 'N/A', codigo: null, ativo: false };
                            const t = bordoMap[reg.telaId] || { numeroSerie: 'N/A', modelo: 'N/A' };
                            const m = bordoMap[reg.magId] || { numeroSerie: 'N/A', modelo: 'N/A' };
                            const c = bordoMap[reg.chipId] || { numeroSerie: 'N/A' };
                            
                            const codigo = e.codigo || reg.codigo || 'N/A'; // Prioriza código do equipamento
                            
                            const isEquipamentoAtivo = e.ativo !== false;
                            const temRadio = !!reg.radioId;
                            const temBordos = reg.telaId || reg.magId || reg.chipId;
                            
                            const bordoStatus = temBordos 
                                ? `<span class="text-green-600 font-semibold">Bordos OK</span>`
                                : `<span class="text-gray-500 italic">Sem Bordos</span>`;
                            
                            // Classe de Linha (Equipamentos Inativos devem ter destaque)
                            const rowClass = isEquipamentoAtivo ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b dark:border-gray-700' : 'hover:bg-red-50 dark:hover:bg-red-900/10 border-b dark:border-gray-700 opacity-60 italic';
                            const frotaDisplay = isEquipamentoAtivo ? e.frota : `${e.frota} (INATIVO)`;
                            
                            // LÓGICA DE BOTÕES DINÂMICOS
                            
                            // Botão Rádio
                            const radioButtonText = temRadio ? 'Desvincular Rádio' : 'Vincular Rádio';
                            const radioButtonClass = temRadio ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-green-main text-white hover:bg-green-700';
                            const radioButtonAction = temRadio 
                                ? `showConfirmModal('Desvincular Rádio', 'Deseja desvincular o Rádio ${r.serie} da Frota ${e.frota}?', () => deleteLink('${reg.id}', 'radio'))`
                                : `showVincularModal('${reg.equipamentoId}', 'radio')`; 
                            
                            // Botão Bordos
                            const bordosButtonText = temBordos ? 'Substituir Bordo' : 'Vincular Bordos';
                            const bordosButtonClass = temBordos ? 'btn btn--secondary btn--sm' : 'btn btn--primary btn--sm';
                            // Ação: Sempre abre o modal de substituição/vínculo para Bordos.
                            const bordosButtonAction = `showVincularModal('${reg.equipamentoId}', 'bordos')`;

                            // Desabilita as ações se o Equipamento estiver INATIVO
                            const actionsDisabled = !isEquipamentoAtivo;
                            const disabledClass = actionsDisabled ? 'opacity-50 cursor-not-allowed' : '';

                            const actionsHtml = `
                                <div class="flex flex-col space-y-1 w-full max-w-xs mx-auto">
                                    <button 
                                        onclick="${actionsDisabled ? '' : radioButtonAction}" 
                                        class="px-2 py-1 text-xs font-semibold rounded-lg shadow-sm transition-colors ${radioButtonClass} ${disabledClass}" 
                                        title="${actionsDisabled ? 'Ações bloqueadas: Equipamento inativo' : radioButtonText}"
                                        ${actionsDisabled ? 'disabled' : ''}>
                                        <i class="fas fa-wifi"></i> ${radioButtonText}
                                    </button>
                                    <button 
                                        onclick="${actionsDisabled ? '' : bordosButtonAction}" 
                                        class="px-2 py-1 text-xs font-semibold rounded-lg shadow-sm transition-colors ${bordosButtonClass} ${disabledClass}"
                                        title="${actionsDisabled ? 'Ações bloqueadas: Equipamento inativo' : bordosButtonText}"
                                        ${actionsDisabled ? 'disabled' : ''}>
                                        <i class="fas fa-microchip"></i> ${bordosButtonText}
                                    </button>
                                </div>
                            `;

                            return `
                                <tr class="${rowClass}">
                                    <td class="num">${codigo}</td>
                                    <td>${frotaDisplay}</td>
                                    <td>${r.serie !== 'N/A' ? `<span class="font-mono">${r.serie}</span>${r.modelo && r.modelo !== 'N/A' ? `<br><span class="text-xs text-gray-400">${r.modelo}</span>` : ''}` : '<span class="text-gray-400">--</span>'}</td>
                                    <td class="hidden sm:table-cell">${e.grupo || '--'}</td>
                                    <td class="hidden md:table-cell">${t.numeroSerie && t.numeroSerie !== 'N/A' ? `<span class="font-mono">${t.numeroSerie}</span>${t.modelo && t.modelo !== 'N/A' ? `<br><span class="text-gray-400">${t.modelo}</span>` : ''}` : '<span class="text-gray-400">--</span>'}</td>
                                    <td class="hidden md:table-cell">${m.numeroSerie && m.numeroSerie !== 'N/A' ? `<span class="font-mono">${m.numeroSerie}</span>${m.modelo && m.modelo !== 'N/A' ? `<br><span class="text-gray-400">${m.modelo}</span>` : ''}` : '<span class="text-gray-400">--</span>'}</td>
                                    <td class="hidden md:table-cell num">${c.numeroSerie && c.numeroSerie !== 'N/A' ? c.numeroSerie : '<span class="text-gray-400">--</span>'}</td>
                                    <td class="hidden lg:table-cell">${e.gestor && e.gestor !== 'Sem Gestor' ? e.gestor : '<span class="text-gray-400">--</span>'}</td>
                                    <td>
                                        ${actionsHtml}
                                    </td>
                                </tr>
                            `;
                        }).join('')}</tbody>
                    </table>
                </div>
                ${geralPaginator}
            </div>
        </div>
    `;
}

function renderPesquisa() {
    const allRecords = dbRegistros.map(reg => {
        const r = dbRadios.find(item => item.id === reg.radioId) || {};
        const e = dbEquipamentos.find(item => item.id === reg.equipamentoId) || {};
        const t = dbBordos.find(item => item.id === reg.telaId && item.tipo === 'Tela') || {};
        const m = dbBordos.find(item => item.id === reg.magId && item.tipo === 'Mag') || {};
        const c = dbBordos.find(item => item.id === reg.chipId && item.tipo === 'Chip') || {};
        const serieRadio = r.serie || 'N/A';
        const bs = [t.numeroSerie, m.numeroSerie, c.numeroSerie].filter(Boolean);
        const serieBordos = bs.length ? bs.join(' / ') : 'N/A';
        const term = `${e.codigo || ''} ${e.frota || ''} ${e.grupo || ''} ${serieRadio} ${serieBordos} ${e.gestor || ''}`.toLowerCase();
        const statusRadio = r.status || 'N/A';
        const statusBordos = [t.status, m.status, c.status].filter(Boolean).join(', ') || 'N/A';
        return {
            id: reg.id,
            reg,
            radio: r,
            equipamento: e,
            tela: t,
            mag: m,
            chip: c,
            codigo: e.codigo || 'N/A',
            frota: e.frota || 'N/A',
            grupo: e.grupo || 'N/A',
            serieRadio,
            serieBordos,
            gestor: e.gestor || 'Sem Gestor',
            term,
            statusRadio,
            statusBordos,
        };
    });

    let filteredRecords = allRecords;
    const searchTerm = (searchTermPesquisa || '').trim().toLowerCase();
    if (searchTerm) {
        filteredRecords = allRecords.filter(r => r.term.includes(searchTerm));
    }

    // Se um relatório está aberto, encontra o registro atualizado
    let reportRecord = null;
    if (pesquisaReport) {
        reportRecord = allRecords.find(r => r.id === pesquisaReport.id) || null;
        if (!reportRecord) {
            pesquisaReport = null;
        }
    }

    // Abre relatório automaticamente se a busca encontrar exatamente 1 resultado
    if (!reportRecord && filteredRecords.length === 1 && searchTerm) {
        reportRecord = filteredRecords[0];
        pesquisaReport = reportRecord;
    }

    const totalPesquisaPages = Math.max(1, Math.ceil(filteredRecords.length / PESQUISA_PAGE_SIZE));
    pesquisaPage = Math.min(pesquisaPage, totalPesquisaPages) || 1;
    const start = (pesquisaPage - 1) * PESQUISA_PAGE_SIZE;
    const paginatedRecords = filteredRecords.slice(start, start + PESQUISA_PAGE_SIZE);

    // --- Mini Relatório ---
    let reportHtml = '';
    if (reportRecord) {
        const eq = reportRecord.equipamento;
        const radio = reportRecord.radio;
        const tela = reportRecord.tela;
        const mag = reportRecord.mag;
        const chip = reportRecord.chip;
        const eqAtivo = eq.ativo !== false;

        reportHtml = `
            <div class="mb-6 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-gray-800 dark:to-gray-750 rounded-xl shadow-lg p-6 border border-green-200 dark:border-green-800">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-xl font-bold text-green-main dark:text-green-400 flex items-center gap-2">
                        <i class="fas fa-file-alt"></i> Mini Relatório
                    </h3>
                    <button onclick="fecharRelatorio()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700" title="Fechar relatório">
                        <i class="fas fa-times fa-lg"></i>
                    </button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
                        <h4 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                            <i class="fas fa-tractor"></i> Equipamento
                        </h4>
                        <div class="space-y-2 text-sm">
                            <div class="flex justify-between"><span class="text-gray-500">Código</span><span class="font-semibold font-mono text-green-main dark:text-green-400">${eq.codigo || 'N/A'}</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Frota</span><span class="font-semibold">${eq.frota || 'N/A'}</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Grupo</span><span class="font-semibold">${eq.grupo || 'N/A'}</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Modelo</span><span class="font-semibold">${eq.modelo || 'N/A'}</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Subgrupo</span><span class="font-semibold">${eq.subgrupo || 'N/A'}</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Gestor</span><span class="font-semibold">${eq.gestor || 'N/A'}</span></div>
                            <div class="flex justify-between">
                                <span class="text-gray-500">Status</span>
                                <span class="font-semibold ${eqAtivo ? 'text-green-600' : 'text-red-500'}">${eqAtivo ? 'Ativo' : 'Inativo'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
                        <h4 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                            <i class="fas fa-wifi"></i> Rádio
                        </h4>
                        <div class="space-y-2 text-sm">
                            <div class="flex justify-between"><span class="text-gray-500">Série</span><span class="font-semibold font-mono">${radio.serie || 'N/A'}</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Modelo</span><span class="font-semibold">${radio.modelo || 'N/A'}</span></div>
                            <div class="flex justify-between">
                                <span class="text-gray-500">Status</span>
                                <span class="font-semibold ${(radio.status || '') === 'Disponível' ? 'text-green-600' : 'text-yellow-600'}">${radio.status || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
                        <h4 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                            <i class="fas fa-microchip"></i> Bordos
                        </h4>
                        <div class="space-y-2 text-sm">
                            ${[['Tela', tela], ['Mag', mag], ['Chip', chip]].map(([nome, b]) => `
                                <div class="border-b border-gray-100 dark:border-gray-700 pb-2 last:border-0 last:pb-0">
                                    <span class="text-xs font-semibold text-gray-400 uppercase">${nome}</span>
                                    <div class="flex justify-between"><span class="text-gray-500">Série</span><span class="font-semibold font-mono">${b.numeroSerie || 'N/A'}</span></div>
                                    <div class="flex justify-between"><span class="text-gray-500">Modelo</span><span class="font-semibold">${b.modelo || 'N/A'}</span></div>
                                    <div class="flex justify-between"><span class="text-gray-500">Status</span><span class="font-semibold">${b.status || 'N/A'}</span></div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
                        <h4 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                            <i class="fas fa-info-circle"></i> Resumo
                        </h4>
                        <div class="space-y-2 text-sm">
                            <div class="flex justify-between"><span class="text-gray-500">Vínculo</span><span class="font-semibold text-green-600">Ativo</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Rádio</span><span class="font-semibold">${radio.serie ? 'Vinculado' : 'Sem vínculo'}</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Bordos</span><span class="font-semibold">${tela.numeroSerie || mag.numeroSerie || chip.numeroSerie ? 'Vinculado' : 'Sem vínculo'}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // --- Tabela de Resultados ---
    let tableRows = '';
    if (paginatedRecords.length > 0) {
        tableRows = paginatedRecords.map(r => `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b dark:border-gray-700 cursor-pointer" onclick="abrirRelatorio('${r.id}')">
                <td class="num">${r.codigo}</td>
                <td>${r.frota}</td>
                <td class="hidden sm:table-cell">${r.grupo}</td>
                <td>${r.serieRadio}</td>
                <td class="hidden md:table-cell num" title="Tela: ${r.tela.numeroSerie || 'N/A'}">${r.tela.numeroSerie || '<span class="text-gray-400 italic">N/A</span>'}</td>
                <td class="hidden md:table-cell num" title="Mag: ${r.mag.numeroSerie || 'N/A'}">${r.mag.numeroSerie || '<span class="text-gray-400 italic">N/A</span>'}</td>
                <td class="hidden md:table-cell num" title="Chip: ${r.chip.numeroSerie || 'N/A'}">${r.chip.numeroSerie || '<span class="text-gray-400 italic">N/A</span>'}</td>
                <td class="hidden lg:table-cell">
                    ${r.gestor}
                    <span class="ml-2 text-xs text-green-main dark:text-green-400"><i class="fas fa-file-alt"></i></span>
                </td>
            </tr>
        `).join('');
    } else {
        tableRows = `
            <tr>
                <td colspan="8" data-label="">
                    <div class="empty-state">
                        <i class="fas fa-folder-open"></i>
                        <span class="empty-state__title">Nenhum registro encontrado</span>
                        <span class="text-xs">Ajuste os termos da busca e tente novamente.</span>
                    </div>
                </td>
            </tr>
        `;
    }

    let pesquisaPaginator = '';
    if (filteredRecords.length > PESQUISA_PAGE_SIZE) {
        pesquisaPaginator = '<div class="pager">';
        pesquisaPaginator += `<button ${pesquisaPage === 1 ? 'disabled' : ''} onclick="setPesquisaPage(-1)" class="btn btn--secondary btn--sm">Anterior</button>`;
        pesquisaPaginator += `<span class="pager__info">Pág ${pesquisaPage} de ${totalPesquisaPages}</span>`;
        pesquisaPaginator += `<button ${pesquisaPage === totalPesquisaPages ? 'disabled' : ''} onclick="setPesquisaPage(1)" class="btn btn--secondary btn--sm">Próxima</button>`;
        pesquisaPaginator += '</div>';
    }

    return `
        <div class="lf-shell">
            <div class="page-head">
                <div>
                    <span class="page-head__eyebrow"><i class="fas fa-magnifying-glass"></i> Consulta</span>
                    <h1 class="page-head__title">Pesquisa de registros ativos</h1>
                    <p class="page-head__sub">${filteredRecords.length} de ${allRecords.length} vínculos exibidos</p>
                </div>
            </div>

            <div class="card card--pad">
                <div class="flex gap-2 mb-4">
                    <input type="search" id="search-term" placeholder="Buscar por código, frota, série, gestor..." value="${searchTermPesquisa}"
                        oninput="handleSearchInput(this, 'searchTermPesquisa', 1)" autocomplete="off" class="flex-1" />
                    <button id="search-button" class="btn btn--primary" title="Iniciar busca">
                        <i class="fas fa-search"></i><span class="hidden sm:inline">Buscar</span>
                    </button>
                </div>

                ${reportHtml}

                <h2 class="section-title mt-6"><i class="fas fa-list"></i> Resultados (${filteredRecords.length})</h2>
                <div class="table-scroll">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Frota</th>
                                <th class="hidden sm:table-cell">Grupo</th>
                                <th>Série Rádio</th>
                                <th class="hidden md:table-cell">Tela</th>
                                <th class="hidden md:table-cell">Mag</th>
                                <th class="hidden md:table-cell">Chip</th>
                                <th class="hidden lg:table-cell">Gestor</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
                ${pesquisaPaginator}
            </div>
        </div>
    `;
}

let radioAmadorCode = '';
let radioAmadorResult = null;

function renderRadioAmador() {
    const found = radioAmadorResult;

    const displayLines = found ? `
        <div class="space-y-1 text-xs leading-tight">
            <div class="flex justify-between"><span class="text-green-400/70">COD:</span><span class="text-amber-300 font-mono font-bold">${found.codigo}</span></div>
            <div class="flex justify-between"><span class="text-green-400/70">FROTA:</span><span class="text-white font-mono">${found.frota}</span></div>
            <div class="flex justify-between"><span class="text-green-400/70">GRUPO:</span><span class="text-white font-mono">${found.grupo}</span></div>
            <div class="flex justify-between"><span class="text-green-400/70">GESTOR:</span><span class="text-white font-mono">${found.gestor}</span></div>
            <div class="flex justify-between border-t border-green-800/50 pt-1 mt-1"><span class="text-green-400/70">RADIO:</span><span class="text-cyan-300 font-mono">${found.serieRadio}</span></div>
            <div class="flex justify-between"><span class="text-green-400/70">BORDOS:</span><span class="text-cyan-300 font-mono truncate max-w-[180px]">${found.serieBordos}</span></div>
        </div>
    ` : '<div class="text-green-700/50 text-xs text-center py-4">AGUARDANDO CÓDIGO</div>';

    return `
        <div class="bg-[#0a0a0a] flex items-center justify-center p-4 rounded-xl my-4">
            <div class="w-full max-w-md">
                <div class="bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1a] rounded-2xl p-6 shadow-2xl border border-green-900/40" style="box-shadow: 0 0 40px rgba(0,255,65,0.05), inset 0 0 40px rgba(0,255,65,0.03);">
                    <div class="text-center mb-4">
                        <div class="text-green-500/40 text-xs tracking-[0.3em] uppercase mb-1">Link-Frota</div>
                        <div class="text-green-400/60 text-[10px] tracking-[0.5em] uppercase">Radio Amador</div>
                    </div>

                    <div class="bg-[#050508] rounded-lg p-4 mb-4 border border-green-900/30 font-mono" style="box-shadow: inset 0 0 20px rgba(0,0,0,0.8), 0 0 10px rgba(0,255,65,0.03);">
                        <div class="flex items-center justify-between mb-3">
                            <span class="text-green-500/50 text-[10px] tracking-wider">RX/TX</span>
                            <span class="text-green-500/30 text-[10px]">
                                <span class="inline-block w-2 h-2 rounded-full bg-green-500/40 animate-pulse mr-1"></span>
                                ONLINE
                            </span>
                        </div>
                        <div class="text-center mb-3">
                            <div class="text-4xl tracking-[0.15em] text-green-400 font-mono font-bold drop-shadow-[0_0_10px_rgba(0,255,65,0.3)]">
                                ${radioAmadorCode || '---'}
                            </div>
                            <div class="text-[10px] text-green-600/50 tracking-[0.3em] mt-1">MHz</div>
                        </div>
                        <div class="border-t border-green-900/30 pt-3">
                            ${displayLines}
                        </div>
                        ${found ? `
                        <div class="border-t border-green-900/30 pt-3 mt-3">
                            <div class="text-[10px] text-green-600/50 mb-2">SINAL</div>
                            <div class="flex items-center gap-1">
                                ${[1,2,3,4,5].map(i => `<div class="h-3 flex-1 rounded-sm ${i <= 5 ? 'bg-green-500/60' : 'bg-green-900/30'}" style="box-shadow: ${i <= 5 ? '0 0 6px rgba(0,255,65,0.4)' : 'none'}"></div>`).join('')}
                            </div>
                        </div>
                        ` : ''}
                    </div>

                    <div class="flex gap-2 mb-3">
                        <input type="text" id="radio-amador-input" value="${radioAmadorCode}" placeholder="DIGITE O CÓDIGO" maxlength="10" class="flex-1 bg-[#050508] border border-green-900/40 rounded-lg px-4 py-3 text-green-400 font-mono text-lg tracking-widest text-center placeholder-green-800/40 focus:outline-none focus:border-green-600/60 focus:ring-1 focus:ring-green-600/30 uppercase" autocomplete="off" />
                    </div>

                    <div class="grid grid-cols-3 gap-2">
                        <button onclick="radioAmadorBuscar()" class="col-span-2 bg-green-900/30 hover:bg-green-800/40 text-green-400 border border-green-700/40 rounded-lg py-3 font-mono text-sm tracking-wider transition-all active:scale-95">
                            <i class="fas fa-search mr-2"></i> PESQUISAR
                        </button>
                        <button onclick="radioAmadorLimpar()" class="bg-red-900/20 hover:bg-red-800/30 text-red-400 border border-red-700/30 rounded-lg py-3 font-mono text-sm tracking-wider transition-all active:scale-95">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="mt-4 text-center">
                        <button onclick="updateState('page', 'pesquisa')" class="text-green-700/50 hover:text-green-500/70 text-xs font-mono tracking-wider transition-colors">
                            <i class="fas fa-arrow-left mr-1"></i> VOLTAR À PESQUISA
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function attachRadioAmadorEvents() {
    const input = document.getElementById('radio-amador-input');
    if (input) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                radioAmadorBuscar();
            }
        };
        input.oninput = (e) => {
            radioAmadorCode = e.target.value.toUpperCase();
        };
    }
}

function radioAmadorBuscar() {
    const code = radioAmadorCode.trim();
    if (!code) return;

    radioAmadorResult = null;
    for (const reg of dbRegistros) {
        const e = dbEquipamentos.find(item => item.id === reg.equipamentoId) || {};
        const r = dbRadios.find(item => item.id === reg.radioId) || {};
        const t = dbBordos.find(item => item.id === reg.telaId && item.tipo === 'Tela') || {};
        const m = dbBordos.find(item => item.id === reg.magId && item.tipo === 'Mag') || {};
        const c = dbBordos.find(item => item.id === reg.chipId && item.tipo === 'Chip') || {};
        const codigo = (e.codigo || '').toUpperCase();
        const frota = (e.frota || '').toUpperCase();
        const serieRadio = (r.serie || '').toUpperCase();
        const term = `${codigo} ${frota} ${serieRadio}`;

        if (term.includes(code)) {
            const bs = [t.numeroSerie, m.numeroSerie, c.numeroSerie].filter(Boolean);
            radioAmadorResult = {
                codigo: e.codigo || 'N/A',
                frota: e.frota || 'N/A',
                grupo: e.grupo || 'N/A',
                gestor: e.gestor || 'Sem Gestor',
                serieRadio: r.serie || 'N/A',
                serieBordos: bs.length ? bs.join(' / ') : 'N/A',
            };
            break;
        }
    }

    if (!radioAmadorResult) {
        radioAmadorResult = { codigo: '---', frota: 'NÃO ENCONTRADO', grupo: '', gestor: '', serieRadio: '---', serieBordos: '' };
    }

    renderApp();
}

function radioAmadorLimpar() {
    radioAmadorCode = '';
    radioAmadorResult = null;
    renderApp();
}

function renderSettings() {
    const isAdmin = currentUser && currentUser.role === 'admin';
    
    const tabs = [
        // Removida aba 'my-profile'
        { id: 'system', name: 'Mapeamento', icon: 'fa-sitemap' },
        { id: 'users', name: 'Usuários', icon: 'fa-users', requiredRole: 'admin' },
    ];

    // Se for admin, a aba 'Mapeamento' (system) é o default.
    const defaultTab = 'system';
    const filteredTabs = tabs.filter(tab => !tab.requiredRole || (tab.requiredRole === 'admin' && isAdmin));

    const tabNav = filteredTabs.map(tab => `
        <a href="#settings/${tab.id}" onclick="updateState('settingTab', '${tab.id}')" class="tab ${currentSettingTab === tab.id ? 'is-active' : ''}">
            <i class="fas ${tab.icon}"></i><span>${tab.name}</span>
        </a>
    `).join('');

    let content = '';
    switch (currentSettingTab) {
        case 'system':
            content = renderSettingsSystem();
            break;
        case 'users':
            content = isAdmin ? "Carregando usuários..." : `<p class="p-6 text-red-500 dark:text-red-400 font-semibold">Acesso negado. Apenas administradores podem gerenciar usuários.</p>`;
            if (isAdmin) {
                // Conteúdo de usuários será renderizado por renderSettingsUsers()
            }
            break;
        default:
            currentSettingTab = defaultTab; // Redireciona default
            content = renderSettingsSystem();
    }

    return `
        <div class="lf-shell">
            <div class="page-head">
                <div>
                    <span class="page-head__eyebrow"><i class="fas fa-sliders"></i> Administração</span>
                    <h1 class="page-head__title">Configurações do sistema</h1>
                    <p class="page-head__sub">Mapeamento de códigos e gestão de acessos</p>
                </div>
            </div>
            <div class="card">
                <div id="settings-nav" class="tabs px-2 md:px-4">${tabNav}</div>
                <div id="settings-content" class="p-4 md:p-6">${content}</div>
            </div>
        </div>
    `;
}

// Removida renderSettingsMyProfile() pois foi movida para o Modal

function renderSettingsSystem() {
    const currentMap = settings.letterMap;
    const nextIndex = settings.nextIndex;
    
    const groupInputs = GROUPS.map(group => {
        const prefix = currentMap[group] || '';
        const indexKey = prefix === 'NUM' ? 'NUM' : prefix;
        const nextNum = nextIndex[indexKey] || 1;	
        const nextCodeDisplay = prefix ? (prefix === 'NUM' ? zpad(nextNum, 3) : prefix + zpad(nextNum, 3)) : 'N/A';

        return `
            <div class="flex items-center space-x-4 border-b pb-3 mb-3 dark:border-gray-600">
                <label class="w-1/3 text-sm font-medium text-gray-700 dark:text-gray-300">${group}</label>
                <input type="text" id="map-${group.replace(/\s/g, '')}" value="${prefix}" required maxlength="3"
                    class="w-1/4 rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border text-center font-mono uppercase dark:bg-gray-700 dark:text-gray-100"
                >
                <div class="w-1/4 text-sm text-gray-500 dark:text-gray-400">
                    Próximo: ${nextCodeDisplay}	
                </div>
            </div>`;
    }).join('');

    return `
        <h4 class="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-6">Mapeamento de Letras por Grupo</h4>
        <form id="form-settings-system" class="space-y-4 max-w-lg">
            <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">Defina a letra ou código para o prefixo do Código de Rastreamento. Use 'NUM' para código sequencial.</p>
            <div class="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg shadow-inner border dark:border-gray-700">
                <div class="flex items-center space-x-4 font-bold text-sm text-gray-800 dark:text-gray-100 border-b-2 pb-2 mb-3 dark:border-gray-600">
                    <span class="w-1/3">Grupo</span>
                    <span class="w-1/4 text-center">Prefixo</span>
                    <span class="w-1/4">Próx. Código</span>
                </div>
                ${groupInputs}
            </div>
            <button type="submit" class="btn btn--primary">
                <i class="fas fa-save mr-2"></i> Salvar Mapeamento
            </button>
        </form>
    `;
}

/**
 * [CORREÇÃO] Função de eventos de Usuários movida para o escopo global.
 */
function attachSettingsUsersEvents() {
    const form = document.getElementById('form-user');
    if (form) {
        form.onsubmit = saveUser;
        const resetButton = document.getElementById('user-reset-btn');
        if (resetButton) {
            resetButton.onclick = () => {
                form.reset();
                document.getElementById('user-id').value = '';
                document.getElementById('user-form-title').textContent = 'Novo Perfil de Usuário';
                document.getElementById('perm-dashboard').checked = true;
                document.getElementById('perm-cadastro').checked = true;
                document.getElementById('perm-pesquisa').checked = true;
                document.getElementById('perm-settings').checked = false;
                document.getElementById('user-password-field').classList.remove('hidden');
            };
        }
        const roleSelect = document.getElementById('user-role');
        if (roleSelect) {
            roleSelect.onchange = () => {
                const settingsCheck = document.getElementById('perm-settings');
                if (roleSelect.value === 'admin') {
                    settingsCheck.checked = true;
                    settingsCheck.disabled = false;
                } else {
                    settingsCheck.checked = false;
                    settingsCheck.disabled = true;
                }
            };
        }
    }
}

// Função de renderização de Usuários com Formulário de CRUD
async function renderSettingsUsers() {
    const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");
    const settingsSnap = await getDoc(settingsDocRef);
    let usersFromDB = settingsSnap.exists() ? settingsSnap.data().users || [] : [];

    // Também busca perfis da coleção users (criados pela recuperação automática)
    try {
        const usersColRef = collection(db, "artifacts", appId, "public", "data", "users");
        const usersSnap = await getDocs(usersColRef);
        usersSnap.forEach(docSnap => {
            const u = docSnap.data();
            if (!usersFromDB.some(ex => ex.username === docSnap.id)) {
                usersFromDB.push({
                    id: u.id || docSnap.id,
                    name: u.name || docSnap.id.split('@')[0],
                    username: docSnap.id,
                    role: u.role || 'user',
                    permissions: u.permissions || { dashboard: true, cadastro: true, pesquisa: true, settings: false }
                });
            }
        });
    } catch (e) {
        console.warn("Erro ao ler users:", e);
    }

    settings.users = usersFromDB;

    const tableRows = usersFromDB.map(u => {
        const isMainAdmin = u.username === ADMIN_PRINCIPAL_EMAIL;
        const isCurrent = currentUser.email === u.username;
        const canEditDelete = !isMainAdmin;
        
        const loginMethod = u.customUsername ? u.customUsername : u.username;

        return `
            <tr class="${isCurrent ? 'row-current' : ''}">
                <td>${u.name} ${isCurrent ? '<span class="badge badge--muted">Você</span>' : ''}</td>
                <td class="num break-words-all">
                    ${loginMethod} 
                    ${u.customUsername ? '<span class="text-xs text-green-main">(User Login)</span>' : '<span class="text-xs text-blue-500">(Email Login)</span>'}
                </td>
                <td><span class="badge ${u.role === 'admin' ? 'badge--ok' : 'badge--info'}">${(u.role || 'N/A').toUpperCase()}</span></td>
                <td>
                    <button onclick="loadUserForEdit('${u.id}')" ${canEditDelete ? '' : 'disabled'} class="act-btn" title="Editar Perfil">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="showPermissionModal('${u.id}')" ${canEditDelete ? '' : 'disabled'} class="text-green-600 hover:text-green-900 p-1 rounded-full hover:bg-green-50 dark:hover:bg-gray-700 ${canEditDelete ? '' : 'opacity-50 cursor-not-allowed'}" title="Alterar permissões">
                        <i class="fas fa-user-cog"></i>
                    </button>
                    <button onclick="showConfirmModal('Confirmar Exclusão', 'Deseja realmente excluir o perfil de ${u.name}? Isso é irreversível.', () => deleteUser('${u.id}'))" ${canEditDelete ? '' : 'disabled'} class="act-btn act-btn--danger" title="Excluir Perfil">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-1 bg-gray-50 dark:bg-gray-900 p-4 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700">
                <h4 id="user-form-title" class="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Novo Perfil de Usuário</h4>
                <form id="form-user" class="space-y-4">
                    <input type="hidden" id="user-id">
                    <div>
                        <label for="user-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Nome Completo <span class="text-red-500">*</span></label>
                        <input type="text" id="user-name" required placeholder="Ex: Maria da Silva"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    
                    <div>
                        <label for="user-custom-username" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Nome de Usuário (Login Principal)</label>
                        <input type="text" id="user-custom-username" placeholder="Ex: mariasilva"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>

                    <div>
                        <label for="user-username" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Username (Email)</label>
                        <input type="email" id="user-username" placeholder="exemplo@empresa.com.br"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border dark:bg-gray-700 dark:text-gray-100">
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Deve ser um email válido ou deixe em branco se usar Nome de Usuário.</p>
                        <p class="text-xs text-red-500 dark:text-red-400 mt-1">Se em branco, um email genérico será criado para o Firebase Auth.</p>
                    </div>
                    
                    <div id="user-password-field">
                        <label for="user-password" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Senha (Mín. 6 caracteres)</label>
                        <input type="password" id="user-password" placeholder="Preencha para novo cadastro ou alteração de senha" minlength="6"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-red-500 focus:ring-red-500 p-2 border dark:bg-gray-700 dark:text-gray-100">
                    </div>

                    <div>
                        <label for="user-role" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Perfil/Role <span class="text-red-500">*</span></label>
                        <select id="user-role" required
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border bg-white dark:bg-gray-700 dark:text-gray-100">
                            <option value="user">Usuário Padrão</option>
                            <option value="admin">Administrador</option>
                        </select>
                    </div>

                    <div class="border-t border-gray-200 dark:border-gray-600 pt-4">
                        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissões de Acesso</label>
                        <div class="space-y-2">
                            <div class="flex items-center">
                                <input id="perm-dashboard" type="checkbox" checked
                                    class="h-4 w-4 text-green-main border-gray-300 dark:border-gray-600 rounded focus:ring-green-main dark:bg-gray-700">
                                <label for="perm-dashboard" class="ml-2 text-sm text-gray-900 dark:text-gray-100">Dashboard</label>
                            </div>
                            <div class="flex items-center">
                                <input id="perm-cadastro" type="checkbox" checked
                                    class="h-4 w-4 text-green-main border-gray-300 dark:border-gray-600 rounded focus:ring-green-main dark:bg-gray-700">
                                <label for="perm-cadastro" class="ml-2 text-sm text-gray-900 dark:text-gray-100">Cadastro</label>
                            </div>
                            <div class="flex items-center">
                                <input id="perm-pesquisa" type="checkbox" checked
                                    class="h-4 w-4 text-green-main border-gray-300 dark:border-gray-600 rounded focus:ring-green-main dark:bg-gray-700">
                                <label for="perm-pesquisa" class="ml-2 text-sm text-gray-900 dark:text-gray-100">Pesquisa</label>
                            </div>
                            <div class="flex items-center">
                                <input id="perm-settings" type="checkbox"
                                    class="h-4 w-4 text-green-main border-gray-300 dark:border-gray-600 rounded focus:ring-green-main dark:bg-gray-700">
                                <label for="perm-settings" class="ml-2 text-sm text-gray-900 dark:text-gray-100">Configurações <span class="text-xs text-red-500 dark:text-red-400">(Admin-Only)</span></label>
                            </div>
                        </div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">Desmarque as abas que o usuário não deve acessar.</p>
                    </div>

                    <div class="flex space-x-3">
                        <button type="submit" class="btn btn--primary flex-1">
                            <i class="fas fa-save mr-2"></i> Salvar Perfil
                        </button>
                        <button type="button" id="user-reset-btn" class="btn btn--secondary">
                            <i class="fas fa-redo"></i>
                        </button>
                    </div>
                </form>
            </div>

            <div class="lg:col-span-2">
                <h4 class="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">Perfis Cadastrados (Total: ${usersFromDB.length})</h4>
                <div class="table-scroll">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th class="min-w-32">Login Principal</th>
                                <th>Perfil</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
                <p class="mt-4 text-sm text-yellow-600 dark:text-yellow-400">
                    A exclusão ou edição do usuário principal (Admin) é bloqueada. 
                    As permissões de um novo usuário ou de um 'admin' são definidas automaticamente no salvamento.
                </p>
            </div>
        </div>
    `;
}

// --- Funções de Eventos (DOM) ---

// 🌟 NOVO: Salva o nome de exibição do usuário
async function savePersonalName(e) {
    e.preventDefault();
    const newName = document.getElementById('profile-name').value.trim();
    if (!newName) {
        showModal('Erro', 'O nome não pode ser vazio.', 'error');
        return;
    }

    const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");
    let usersFromDB = settings.users;
    const userIndex = usersFromDB.findIndex(u => u.id === currentUser.id);

    if (userIndex === -1) {
        showModal('Erro', 'Seu perfil não foi encontrado no banco de dados.', 'error');
        return;
    }

    usersFromDB[userIndex].name = newName;
    currentUser.name = newName; // Atualiza o estado global

    try {
        await setDoc(settingsDocRef, { users: usersFromDB }, { merge: true });
        showModal('Sucesso', 'Nome de exibição atualizado com sucesso!', 'success');
        hideProfileModal();
        renderApp();
    } catch (e) {
        showModal('Erro', 'Não foi possível salvar o nome.', 'error');
    }
}

// 🌟 NOVO: Altera a senha do usuário logado (requer reautenticação)
async function changePassword(e) {
    e.preventDefault();
    const newPassword = document.getElementById('profile-new-password').value;
    const confirmPassword = document.getElementById('profile-confirm-password').value;

    if (newPassword !== confirmPassword) {
        showModal('Erro', 'As senhas não coincidem.', 'error');
        return;
    }
    if (newPassword.length < 6) {
        showModal('Erro', 'A nova senha deve ter no mínimo 6 caracteres.', 'error');
        return;
    }

    try {
        const user = auth.currentUser;
        
        if (user) {
            // ATUALIZAÇÃO UNIFICADA: 
            // Independente se usa Email ou Nome de Usuário, a senha é atualizada no sistema de Autenticação do Firebase.
            await updatePassword(user, newPassword);
            
            showModal('Sucesso', 'Sua senha foi atualizada com sucesso! Use a nova senha no próximo login.', 'success');
            hideProfileModal();
            
            // Limpa o formulário
            document.getElementById('form-change-password').reset();
        } else {
            showModal('Erro', 'Sessão não identificada. Por favor, faça login novamente.', 'error');
        }

    } catch (e) {
        console.error("Erro ao alterar senha:", e);
        
        let msg = 'Erro ao alterar a senha.';
        if (e.code === 'auth/requires-recent-login') {
            // Medida de segurança do Firebase
            msg = 'Por segurança, esta operação exige um login recente. Saia do sistema (Logout) e entre novamente para alterar sua senha.';
        } else if (e.code === 'auth/weak-password') {
            msg = 'A senha é muito fraca. Use letras e números.';
        }
        
        showModal('Erro de Segurança', msg, 'error');
    }
}


function handleSearchInput(inputElement, stateVariable, pageToReset = null) {
    const value = inputElement.value;
    const cursorPos = inputElement.selectionStart;
    focusedSearchInputId = inputElement.id;	
    searchCursorPosition = cursorPos;	

    if (stateVariable === 'radioSearch') radioSearch = value.toLowerCase();
    else if (stateVariable === 'equipamentoSearch') equipamentoSearch = value.toLowerCase();
    // 🌟 NOVO: Salva o termo de busca da aba Bordos
    else if (stateVariable === 'bordosSearch') bordosSearch = value.toLowerCase();
    else if (stateVariable === 'geralSearch') geralSearch = value.toLowerCase();
    // 🌟 NOVO: Salva o termo de busca da pesquisa
    else if (stateVariable === 'searchTermPesquisa') searchTermPesquisa = value.toLowerCase();
    else if (stateVariable === '_searchTermTemp') window._searchTermTemp = value;	
    
    if (pageToReset) {
        if (stateVariable === 'radioSearch') radioPage = 1;
        else if (stateVariable === 'equipamentoSearch') equipamentoPage = 1;
        // 🌟 NOVO: Reseta a página de Bordos
        else if (stateVariable === 'bordosSearch') bordosPage = 1;
        else if (stateVariable === 'geralSearch') geralPage = 1;
        // 🌟 NOVO: Reseta a página de pesquisa
        else if (stateVariable === 'searchTermPesquisa') pesquisaPage = 1;
    }

    renderApp();
}

async function handleLogout() {
    try {
        await signOut(auth);
    } catch (error) {
        showModal('Erro', 'Não foi possível sair. Tente novamente.', 'error');
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const loginInput = document.getElementById('login-input');
    const passwordInput = document.getElementById('password');
    const rememberMeCheckbox = document.getElementById('remember-me');
    
    const loginIdentifier = loginInput.value.trim();
    const password = passwordInput.value;
    
    // Validação simples de preenchimento
    if (!loginIdentifier || !password) {
        showModal('Atenção', 'Por favor, preencha o usuário/email e a senha.', 'warning');
        return;
    }

    // Salva preferência de "Lembrar Login"
    if (rememberMeCheckbox.checked) {
        localStorage.setItem('rememberedLogin', loginIdentifier);
    } else {
        localStorage.removeItem('rememberedLogin');
    }

    // Ativa o estado de carregamento
    isLoggingIn = true;
    renderApp(); 

    let emailToLogin = '';
    
    // 1. Identifica se o usuário digitou um Email ou um Nome de Usuário
    if (isEmail(loginIdentifier)) {
        emailToLogin = loginIdentifier;
    } else {
        // Se digitou nome de usuário, precisamos descobrir o email atrelado a ele.
        // Buscamos na lista de configurações carregada na inicialização.
        const appUser = settings.users.find(u => 
            u.customUsername && u.customUsername.toLowerCase() === loginIdentifier.toLowerCase()
        );
        
        if (appUser) {
            emailToLogin = appUser.username;
        } else {
            // Se não encontrou o nome de usuário na lista local
            isLoggingIn = false;
            renderApp();
            showModal('Erro de Login', 'Usuário não encontrado no cadastro do sistema.', 'error');
            return;
        }
    }
    
    // 2. Autenticação OBRIGATÓRIA via Firebase Auth
    // Aqui removemos a checagem local. A senha quem valida é o Firebase.
    try {
        await signInWithEmailAndPassword(auth, emailToLogin, password);
        
        // Se der certo, não precisamos fazer mais nada aqui.
        // O "onAuthStateChanged" (que já está configurado no seu código) vai detectar
        // a mudança de estado e carregar o Dashboard automaticamente.
        console.log("Login validado com sucesso pelo Firebase.");

    } catch (error) {
        console.error("Erro no login:", error);
        isLoggingIn = false;
        renderApp(); // Remove a tela de carregamento
        
        let msg = 'Falha ao entrar. Verifique suas credenciais.';
        
        // Tradução de erros comuns do Firebase para o usuário
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email') {
            msg = 'Usuário não encontrado ou email inválido.';
        } else if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            msg = 'Senha incorreta.';
        } else if (error.code === 'auth/too-many-requests') {
            msg = 'Muitas tentativas consecutivas. Aguarde um momento antes de tentar novamente.';
        } else if (error.code === 'auth/user-disabled') {
            msg = 'Este usuário foi desativado no sistema.';
        }
        
        showModal('Acesso Negado', msg, 'error');
    }
}

async function fetchAppUserProfile(email) {
    if (!db || !appId) return null;
    
    // [CORREÇÃO] Apenas retorna o perfil da lista pré-carregada ou recarrega.
    const appUser = settings.users.find(u => u.username === email);	
    return appUser || null;
}

function attachLoginEvents() {
    const form = document.getElementById('login-form');
    const solicitacaoForm = document.getElementById('form-solicitar-acesso');
    const passwordInput = document.getElementById('password');
    const togglePasswordButton = document.getElementById('toggle-password');
    const togglePasswordIcon = document.getElementById('toggle-password-icon');
    const tempPasswordInput = document.getElementById('temp-password');
    const toggleTempPasswordButton = document.getElementById('toggle-temp-password');
    const toggleTempPasswordIcon = document.getElementById('toggle-temp-password-icon');

    if (form) {
        form.onsubmit = handleLoginSubmit;	
        
        if (passwordInput) {
            passwordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleLoginSubmit(e);
            });
        }
        if (togglePasswordButton) {
            togglePasswordButton.addEventListener('click', () => {
                const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                passwordInput.setAttribute('type', type);
                togglePasswordIcon.classList.toggle('fa-eye');
                togglePasswordIcon.classList.toggle('fa-eye-slash');
            });
        }
    }
    // Anexar evento do novo formulário
    if (solicitacaoForm) {
        solicitacaoForm.onsubmit = handleSolicitarAcesso;
        
        if (toggleTempPasswordButton && tempPasswordInput) {
            toggleTempPasswordButton.addEventListener('click', () => {
                const type = tempPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                tempPasswordInput.setAttribute('type', type);
                toggleTempPasswordIcon.classList.toggle('fa-eye');
                toggleTempPasswordIcon.classList.toggle('fa-eye-slash');
            });
        }
    }
}

function attachCadastroEvents() {
    const nav = document.getElementById('cadastro-nav');
    if(nav) {
        nav.onclick = (e) => {
            const button = e.target.closest('button');
            if (button) {
                const tabId = button.dataset.tab;
                if (tabId && tabId !== currentCadastroTab) {
                    updateState('cadastroTab', tabId);
                }
            }
        };
    }
    
    if (currentCadastroTab === 'radio') attachCadastroRadioEvents();
    else if (currentCadastroTab === 'equipamento') attachCadastroEquipamentoEvents();
    // 🌟 NOVO: Anexa eventos da aba Bordos
    else if (currentCadastroTab === 'bordos') attachCadastroBordosEvents();
    else if (currentCadastroTab === 'geral') attachCadastroGeralEvents();
}

function attachCadastroRadioEvents() {
    const form = document.getElementById('form-radio');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('radio-id').value;
            const serie = document.getElementById('radio-serie').value.trim();
            const modelo = document.getElementById('radio-modelo').value.trim();
            const status = document.getElementById('radio-status').value;
            
            if (!serie || !modelo) {
                showModal('Erro', 'Número de Série e Modelo são obrigatórios.', 'error');
                return;
            }
            
            // Checagem de duplicidade: deve ser única entre todos os rádios (mesmo ativos ou inativos)
            const isDuplicateSerie = dbRadios.some(r => r.serie === serie && r.id !== id);
            if (isDuplicateSerie) {
                showModal('Erro', `Este Número de Série (${serie}) já está cadastrado.`, 'error');
                return;
            }

            const record = { id, serie, modelo, status };
            let precisaDesvincularSinistro = false;

            if (id) {
                const existingRadio = dbRadios.find(r => r.id === id);
                if (existingRadio && existingRadio.status === 'Em Uso' && status !== 'Em Uso') {
                    if (status === 'Sinistro') {
                        // 🌟 CORREÇÃO: Sinistro (perdido/queimado) desvincula automaticamente da Frota,
                        // ao invés de bloquear a troca de status.
                        precisaDesvincularSinistro = true;
                    } else {
                        record.status = 'Em Uso';	
                        showModal('Aviso', 'O status "Em Uso" só pode ser alterado na aba "Geral" (pela desvinculação).', 'warning');
                    }
                }
            }

            await saveRecord('radios', record);	

            if (precisaDesvincularSinistro) {
                await autoUnlinkOnSinistro('radios', id);
                await refreshDataFromFirestore();
                showModal('Sucesso', 'Rádio marcado como Sinistro e desvinculado automaticamente da Frota.', 'success');
            }
            
            form.reset();
            document.getElementById('radio-id').value = '';
        };
    }
}

function loadRadioForEdit(id) {
    const radio = dbRadios.find(r => r.id === id);
    if (radio) {
        document.getElementById('radio-id').value = radio.id;
        document.getElementById('radio-serie').value = radio.serie;
        document.getElementById('radio-modelo').value = radio.modelo;
        document.getElementById('radio-status').value = radio.status || 'Disponível';
        
        const statusSelect = document.getElementById('radio-status');
        const emUsoOption = statusSelect.querySelector('option[value="Em Uso"]');
        if (emUsoOption) {
            if (radio.status === 'Em Uso') {
                emUsoOption.disabled = false;
            } else {
                emUsoOption.disabled = true;
            }
        }
        
        showModal('Edição', `Carregando Rádio ${radio.serie} para edição.`, 'info');
        window.scrollTo(0, 0);
    } else {
        showModal('Erro', 'Rádio não encontrado.', 'error');
    }
}

// --- NOVO: Função para carregar dados de Bordo para edição (Corrigida e no escopo global) ---
function loadBordoForEdit(id) {
    const bordo = dbBordos.find(b => b.id === id);
    if (bordo) {
        document.getElementById('bordo-id').value = bordo.id;
        document.getElementById('bordo-tipo').value = bordo.tipo;
        document.getElementById('bordo-serie').value = bordo.numeroSerie;
        document.getElementById('bordo-modelo').value = bordo.modelo;
        document.getElementById('bordo-status').value = bordo.status || 'Disponível';

        const statusSelect = document.getElementById('bordo-status');
        const emUsoOption = statusSelect.querySelector('option[value="Em Uso"]');
        if (emUsoOption) {
            if (bordo.status === 'Em Uso') {
                emUsoOption.disabled = false;
            } else {
                emUsoOption.disabled = true;
            }
        }

        showModal('Edição', `Carregando Bordo ${bordo.numeroSerie} (${bordo.tipo}) para edição.`, 'info');
        window.scrollTo(0, 0);
    } else {
        showModal('Erro', 'Bordo não encontrado.', 'error');
    }
}
// --- Fim da correção ---


// --- NOVO: Função de Eventos para a aba Bordos (Adicionado no escopo global) ---
function attachCadastroBordosEvents() {
    const form = document.getElementById('form-bordos');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('bordo-id').value;
            const tipo = document.getElementById('bordo-tipo').value;
            const numeroSerie = document.getElementById('bordo-serie').value.trim();
            const modelo = document.getElementById('bordo-modelo').value.trim();
            const status = document.getElementById('bordo-status').value;

            if (!tipo || !numeroSerie || !modelo) {
                showModal('Erro', 'Tipo, Número de Série e Modelo são obrigatórios.', 'error');
                return;
            }

            // Checagem de duplicidade: Tipo + Número de Série deve ser único.
            const isDuplicate = dbBordos.some(b => 
                b.tipo === tipo && b.numeroSerie === numeroSerie && b.id !== id
            );
            
            if (isDuplicate) {
                showModal('Erro', `Este Bordo (${tipo}: ${numeroSerie}) já está cadastrado.`, 'error');
                return;
            }

            const record = { id, tipo, numeroSerie, modelo, status };
            let precisaDesvincularSinistro = false;

            if (id) {
                const existingBordo = dbBordos.find(b => b.id === id);
                if (existingBordo && existingBordo.status === 'Em Uso' && status !== 'Em Uso') {
                    if (status === 'Sinistro') {
                        // 🌟 CORREÇÃO: Sinistro (perdido/queimado) desvincula automaticamente da Frota,
                        // ao invés de bloquear a troca de status.
                        precisaDesvincularSinistro = true;
                    } else {
                        record.status = 'Em Uso';	
                        showModal('Aviso', 'O status "Em Uso" só pode ser alterado na aba "Geral" (pela desvinculação).', 'warning');
                    }
                }
            }

            await saveRecord('bordos', record);	

            if (precisaDesvincularSinistro) {
                await autoUnlinkOnSinistro('bordos', id);
                await refreshDataFromFirestore();
                showModal('Sucesso', `Bordo (${tipo}) marcado como Sinistro e desvinculado automaticamente da Frota.`, 'success');
            }
            
            form.reset();
            document.getElementById('bordo-id').value = '';
        };
    }
}
// --- Fim da nova função de eventos ---


function attachCadastroEquipamentoEvents() {
    const form = document.getElementById('form-equipamento');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const id = document.getElementById('equipamento-id').value;
            const frota = document.getElementById('equipamento-frota').value.trim();
            const grupo = document.getElementById('equipamento-grupo').value;
            const modelo = document.getElementById('equipamento-modelo').value.trim();
            const subgrupo = document.getElementById('equipamento-subgrupo').value.trim();
            const gestor = document.getElementById('equipamento-gestor').value.trim() || 'Sem Gestor';
            
            if (!frota || !grupo || !modelo || !subgrupo) {
                showModal('Erro', 'Todos os campos, exceto Gestor, são obrigatórios.', 'error');
                return;
            }
            
            // Checagem de duplicidade: deve ser única entre todas as frotas
            const isDuplicateFrota = dbEquipamentos.some(eq => eq.frota === frota && eq.id !== id);
            if (isDuplicateFrota) {
                showModal('Erro', `Esta Frota (${frota}) já está cadastrada.`, 'error');
                return;
            }

            const record = { id, frota, grupo, modelo, subgrupo, gestor };
            await saveRecord('equipamentos', record);	
            
            form.reset();
            document.getElementById('equipamento-id').value = '';
        };
    }
}

function loadEquipamentoForEdit(id) {
    const equipamento = dbEquipamentos.find(e => e.id === id);
    if (equipamento) {
        document.getElementById('equipamento-id').value = equipamento.id;
        document.getElementById('equipamento-frota').value = equipamento.frota;
        document.getElementById('equipamento-grupo').value = equipamento.grupo;
        document.getElementById('equipamento-modelo').value = equipamento.modelo;
        document.getElementById('equipamento-subgrupo').value = equipamento.subgrupo;
        document.getElementById('equipamento-gestor').value = equipamento.gestor === 'Sem Gestor' ? '' : equipamento.gestor;

        showModal('Edição', `Carregando Frota ${equipamento.frota} para edição.`, 'info');
        window.scrollTo(0, 0);
    } else {
        showModal('Erro', 'Equipamento não encontrado.', 'error');
    }
}

async function deleteEquipamento() {
    const id = document.getElementById('equipamento-id').value;
    if (!id) return;

    const hasLink = dbRegistros.some(reg => reg.equipamentoId === id);
    if (hasLink) {
        showModal('Ação Bloqueada', 'Não é possível excluir um equipamento que possui vínculos (Rádio e/ou Bordos). Desvincule na aba "Geral" primeiro.', 'error');
        return;
    }

    const equipamento = dbEquipamentos.find(e => e.id === id);
    showConfirmModal('Confirmar Exclusão', `Deseja realmente excluir o Equipamento ${equipamento?.frota || id}? Esta ação não pode ser desfeita.`, async () => {
        try {
            const colPath = `artifacts/${appId}/public/data/equipamentos`;
            await deleteDoc(doc(db, colPath, id));
            document.getElementById('form-equipamento').reset();
            document.getElementById('equipamento-id').value = '';
            await refreshDataFromFirestore();
            showModal('Sucesso', 'Equipamento excluído permanentemente.', 'success');
        } catch (error) {
            console.error('Erro ao excluir equipamento:', error);
            showModal('Erro', 'Ocorreu um erro ao excluir o equipamento.', 'error');
        }
    });
}

function attachCadastroGeralEvents() {
    const equipamentoSelect = document.getElementById('geral-equipamento-id');
    const radioSelect = document.getElementById('geral-radio-id');
    const telaSelect = document.getElementById('geral-tela-id');
    const magSelect = document.getElementById('geral-mag-id');
    const chipSelect = document.getElementById('geral-chip-id');

    // Elementos de bordo para iteração
    const bordoSelects = [telaSelect, magSelect, chipSelect];

    // INICIALIZAÇÃO DO TOM SELECT
    const initTomSelect = (el, placeholder) => {
        if (typeof TomSelect === 'undefined' || !el) return; 
        if (el && !el.TomSelect) {
            // Apenas inicializa se a instância ainda não existe
            new TomSelect(el, {
                plugins: ['dropdown_input'],
                maxItems: 1,
                allowEmptyOption: true,
                placeholder: placeholder,
            });
        }
    };

    // Destrói instâncias TomSelect antigas se existirem (para limpar options)
    const destroyTomSelect = (el) => {
        if (el && el.TomSelect) {
            el.TomSelect.destroy();
        }
    };
    
    // Destrói e Recria os TomSelects
    destroyTomSelect(equipamentoSelect);
    destroyTomSelect(radioSelect);
    destroyTomSelect(telaSelect);
    destroyTomSelect(magSelect);
    destroyTomSelect(chipSelect);
    
    // O renderCadastroGeral já injeta o HTML com as options corretas.
    // Basta inicializar as instâncias.
    initTomSelect(equipamentoSelect, 'Digite para buscar a Frota...');
    initTomSelect(radioSelect, 'Digite para buscar o Rádio...');
    initTomSelect(telaSelect, 'Selecione a Tela Disponível...');
    initTomSelect(magSelect, 'Selecione o Mag Disponível...');
    initTomSelect(chipSelect, 'Selecione o Chip Disponível...');

    
    // Lógica para atualizar info do equipamento
    if (equipamentoSelect) {
        equipamentoSelect.onchange = () => {
            const equipamentoId = equipamentoSelect.value;
            const infoGrupo = document.getElementById('info-grupo');
            const infoSubgrupo = document.getElementById('info-subgrupo');
            const infoGestor = document.getElementById('info-gestor');
            const infoCodigo = document.getElementById('info-codigo');
            
            if(infoGrupo && infoSubgrupo && infoGestor && infoCodigo){	
                if (equipamentoId) {
                    const equipamento = dbEquipamentos.find(e => e.id === equipamentoId);
                    if (equipamento) {
                        infoGrupo.textContent = equipamento.grupo;
                        infoSubgrupo.textContent = equipamento.subgrupo;
                        infoGestor.textContent = equipamento.gestor;

                        // Se o equipamento já tem um código (ou seja, já foi vinculado alguma vez)
                        if (equipamento.codigo) {
                            infoCodigo.innerHTML = `<span class="font-bold text-green-main">${equipamento.codigo}</span> (Código já vinculado)`;
                        } else {
                            infoCodigo.innerHTML = `<span class="font-semibold text-yellow-600">Nenhum</span> (Será gerado ao salvar)`;
                        }
                        
                        // Também verifica se a frota já tem um registro ativo (que impede a criação de novo vínculo)
                        const isLinked = dbRegistros.some(reg => reg.equipamentoId === equipamentoId);
                        const submitBtn = document.querySelector('#form-geral button[type="submit"]');

                        if (isLinked) {
                            submitBtn.disabled = true;
                            submitBtn.dataset.frotaLocked = 'true';
                            submitBtn.textContent = 'Frota já em uso (Gerencie abaixo)';
                            submitBtn.classList.add('bg-gray-400', 'hover:bg-gray-400');
                            submitBtn.classList.remove('bg-green-main', 'hover:bg-green-700');
                            
                            // Bloqueia as seleções de Rádio e Bordo quando a frota já está em uso
                            if(radioSelect && radioSelect.TomSelect) radioSelect.TomSelect.disable();
                            bordoSelects.forEach(s => { if(s && s.TomSelect) s.TomSelect.disable(); });
                            
                            showModal('Aviso', 'Esta Frota já possui vínculos ativos. Por favor, use os botões na tabela abaixo para gerenciar (Desvincular/Vincular).', 'warning');
                        } else {
                            submitBtn.disabled = false;
                            submitBtn.dataset.frotaLocked = 'false';
                            submitBtn.textContent = 'Criar Novo Vínculo';
                            submitBtn.classList.remove('bg-gray-400', 'hover:bg-gray-400');
                            submitBtn.classList.add('bg-green-main', 'hover:bg-green-700');
                            
                            // Habilita as seleções para novo vínculo
                            if(radioSelect && radioSelect.TomSelect) radioSelect.TomSelect.enable();
                            bordoSelects.forEach(s => { if(s && s.TomSelect) s.TomSelect.enable(); });

                            // Limpa as seleções de Rádio/Bordo ao escolher uma frota "livre"
                            if(radioSelect && radioSelect.TomSelect) radioSelect.TomSelect.clear();
                            bordoSelects.forEach(s => { if(s && s.TomSelect) s.TomSelect.clear(); });
                        }

                    } else {
                        infoGrupo.textContent = 'N/A'; infoSubgrupo.textContent = 'N/A'; infoGestor.textContent = 'N/A';
                        infoCodigo.textContent = 'N/A';
                    }
                } else {
                    infoGrupo.textContent = 'N/A'; infoSubgrupo.textContent = 'N/A'; infoGestor.textContent = 'N/A';
                    infoCodigo.textContent = 'N/A';
                }
            }
        };
        // Dispara o change para carregar o estado inicial (importante no refresh)
        equipamentoSelect.dispatchEvent(new Event('change'));
    }

    // Lógica de obrigatoriedade dos Bordos (mantida para o formulário de CRIAÇÃO)
    const checkBordoObligatoriedade = () => {
        const selectedBordos = bordoSelects.filter(s => s.value).length;
        const submitBtn = document.querySelector('#form-geral button[type="submit"]');
        
        // Se a frota já estiver em uso, a validação de obrigatoriedade não se aplica (o botão fica travado por essa razão específica)
        if (submitBtn.dataset.frotaLocked === 'true') return;

        // Regra: Se 1 ou 2 bordos são selecionados, não pode submeter
        if (selectedBordos > 0 && selectedBordos < 3) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Selecione todos os 3 Bordos';
            submitBtn.classList.add('bg-red-400', 'hover:bg-red-400');
            submitBtn.classList.remove('bg-green-main', 'hover:bg-green-700');
            return;
        } 
        
        // Se 3 bordos ou 0 bordos estão selecionados, e Rádio está em 0, e Frota está em 1, valida o mínimo
        const radioSelected = !!radioSelect.value;
        const equipamentoSelected = !!equipamentoSelect.value;

        if (equipamentoSelected && (radioSelected || selectedBordos === 3)) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Criar Novo Vínculo';
            submitBtn.classList.remove('bg-red-400', 'hover:bg-red-400', 'bg-gray-400');
            submitBtn.classList.add('bg-green-main', 'hover:bg-green-700');
        } else if (equipamentoSelected) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Selecione Rádio ou Bordos';
            submitBtn.classList.add('bg-gray-400', 'hover:bg-gray-400');
            submitBtn.classList.remove('bg-green-main', 'hover:bg-green-700', 'bg-red-400');
        }
    };
    
    bordoSelects.forEach(s => {
        if (s) {
            s.onchange = checkBordoObligatoriedade;
            // Dispara o change para o estado inicial
            s.dispatchEvent(new Event('change'));
        }
    });
    
    // Garante que o Rádio também dispara a validação de mínimo
    if (radioSelect) {
        radioSelect.onchange = checkBordoObligatoriedade;
        radioSelect.dispatchEvent(new Event('change'));
    }

    const form = document.getElementById('form-geral');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            
            const radioId = radioSelect.value || null;
            const equipamentoId = equipamentoSelect.value;
            const telaId = telaSelect.value || null;
            const magId = magSelect.value || null;
            const chipId = chipSelect.value || null;
            
            const bordosSelecionados = [telaId, magId, chipId].filter(id => id).length;

            // Validação de Frota
            if (!equipamentoId) {
                showModal('Erro', 'A Frota (Equipamento) é obrigatória para qualquer vínculo.', 'error');
                return;
            }
            // Validação de Mínimo
            if (!radioId && bordosSelecionados === 0) {
                 showModal('Erro', 'Para criar um novo registro, selecione um Rádio ou o Kit de Bordos (3 itens).', 'error');
                 return;
            }
            // Validação de Kit Bordo Completo
            if (bordosSelecionados > 0 && bordosSelecionados < 3) {
                 showModal('Erro de Bordo', 'Vínculo de Bordos: Se você selecionou um item de Bordo, deve selecionar todos os três (Tela, Mag e Chip).', 'error');
                 return;
            }
            
            // Checagem de item já vinculado
            const allLinkedItems = [radioId, telaId, magId, chipId].filter(id => id);
            for(const itemId of allLinkedItems) {
                 const isRadio = radioId === itemId;
                 const item = isRadio ? dbRadios.find(r => r.id === itemId) : dbBordos.find(b => b.id === itemId);
                 const isLinked = dbRegistros.some(reg => 
                     reg.radioId === itemId || reg.telaId === itemId || reg.magId === itemId || reg.chipId === itemId
                 );
                 if (isLinked) {
                     const itemType = isRadio ? 'Rádio' : item.tipo;
                     showModal('Item Já Vinculado', `${itemType} ${item.serie || item.numeroSerie} já está em uso em outra Frota. Desvincule-o primeiro.`, 'error');
                     return;
                 }
                 // Validação de Sinistro: itens com status diferente de "Disponível" não podem ser vinculados
                 if (item && item.status !== 'Disponível') {
                     const itemType = isRadio ? 'Rádio' : (item.tipo || 'Item');
                     showModal('Item Indisponível', `${itemType} ${item.serie || item.numeroSerie} está com status "${item.status}" e não pode ser vinculado. Altere para "Disponível" primeiro.`, 'error');
                     return;
                 }
            }


            // [LÓGICA DE CÓDIGO E SALVAMENTO]
            const equipamentoRef = doc(db, `artifacts/${appId}/public/data/equipamentos`, equipamentoId);
            const equipamentoSnap = await getDoc(equipamentoRef);
            
            if (!equipamentoSnap.exists()) {
                showModal('Erro', 'Equipamento não encontrado.', 'error');
                return;
            }

            const equipamento = { id: equipamentoSnap.id, ...equipamentoSnap.data() };
            let codigoDoEquipamento = equipamento.codigo;


            // 1. Gera o código se não existir
            if (!codigoDoEquipamento) {
                codigoDoEquipamento = generateCode(equipamento.grupo);	
                if (!codigoDoEquipamento) return; 

                try {
                    await updateDoc(equipamentoRef, { codigo: codigoDoEquipamento });
                } catch (e) {
                    showModal('Erro', 'Não foi possível salvar o novo código no equipamento.', 'error');
                    return;
                }
            }
            
            // 2. CONSTRÓI O NOVO REGISTRO
            let record = {
                radioId: radioId,
                equipamentoId: equipamentoId,
                codigo: codigoDoEquipamento, 
                telaId: telaId, 
                magId: magId,
                chipId: chipId,
                createdAt: new Date().toISOString()
            };

            
            try {
                const batch = writeBatch(db);
                
                // Cria um novo registro
                const newRegRef = doc(collection(db, `artifacts/${appId}/public/data/registros`));
                batch.set(newRegRef, record);
                
                // Atualiza o status do Rádio (se fornecido)
                if (radioId) {
                    const radioRef = doc(db, `artifacts/${appId}/public/data/radios`, radioId);
                    batch.update(radioRef, { status: 'Em Uso' });
                }

                // Atualiza o status dos Bordos para 'Em Uso' (se fornecidos)
                if (telaId) {
                    const telaRef = doc(db, `artifacts/${appId}/public/data/bordos`, telaId);
                    batch.update(telaRef, { status: 'Em Uso' });
                }
                if (magId) {
                    const magRef = doc(db, `artifacts/${appId}/public/data/bordos`, magId);
                    batch.update(magRef, { status: 'Em Uso' });
                }
                if (chipId) {
                    const chipRef = doc(db, `artifacts/${appId}/public/data/bordos`, chipId);
                    batch.update(chipRef, { status: 'Em Uso' });
                }

                await batch.commit();

                showModal('Sucesso!', `Novo Vínculo criado. Código: ${codigoDoEquipamento}`, 'success');
                await refreshDataFromFirestore();
                // Limpa e atualiza os selects
                form.reset();
                if(radioSelect && radioSelect.TomSelect) radioSelect.TomSelect.clear();
                if(equipamentoSelect && equipamentoSelect.TomSelect) equipamentoSelect.TomSelect.clear();
                if(telaSelect && telaSelect.TomSelect) telaSelect.TomSelect.clear();
                if(magSelect && magSelect.TomSelect) magSelect.TomSelect.clear();
                if(chipSelect && chipSelect.TomSelect) chipSelect.TomSelect.clear();
                
                // refreshDataFromFirestore() fará o renderApp após atualizar os dados.
                
            } catch (error) {
                console.error("Erro ao salvar associação:", error);
                showModal('Erro', 'Ocorreu um erro ao salvar a associação.', 'error');
            }
        };
    }
}

function attachPesquisaEvents() {
    const searchInput = document.getElementById('search-term');
    if(searchInput) {
        // Garantindo que a busca reinicie a página de pesquisa
        searchInput.oninput = (e) => handleSearchInput(e.target, 'searchTermPesquisa', 1);
        
        const searchButton = document.getElementById('search-button');
        if(searchButton) {
            searchButton.onclick = () => searchInput.dispatchEvent(new Event('input'));
        }
    }
}

function attachSettingsEvents() {
    // Removido attachSettingsMyProfileEvents daqui
    if (currentSettingTab === 'system') {
        attachSettingsSystemEvents();
    } else if (currentSettingTab === 'users' && currentUser && currentUser.role === 'admin') {
        attachSettingsUsersEvents(); 
    }
}

// Removida attachSettingsMyProfileEvents()


function attachSettingsSystemEvents() {
    const form = document.getElementById('form-settings-system');
    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            
            let newLetterMap = {};
            let isValid = true;
            
            GROUPS.forEach(group => {
                const input = document.getElementById(`map-${group.replace(/\s/g, '')}`);
                if (input) {
                    newLetterMap[group] = input.value.trim().toUpperCase();
                    if (!newLetterMap[group]) {
                        isValid = false;
                        showModal('Erro', `O prefixo para '${group}' não pode ser vazio.`, 'error');
                    }
                }
            });

            if (isValid) {
                const newNextIndex = { ...settings.nextIndex };
                
                // Garantir que todos os prefixes do novo mapa existem no nextIndex
                Object.values(newLetterMap).forEach(prefix => {
                    const indexKey = prefix === 'NUM' ? 'NUM' : prefix;
                    // Se a nova chave não existe no nextIndex, inicializa em 1
                    if (newNextIndex[indexKey] === undefined) newNextIndex[indexKey] = 1; 
                });

                settings.letterMap = newLetterMap;
                settings.nextIndex = newNextIndex;	
                
                await saveSettings();	

                showModal('Sucesso', 'Mapeamento de letras salvo!', 'success');
                renderApp();	
            }
        };
    }
}

async function showPermissionModal(userId)	
{
    // [CORREÇÃO] Usa appId hardcoded
    const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");
    const settingsSnap = await getDoc(settingsDocRef);
    if (!settingsSnap.exists()) {
        showModal('Erro', 'Não foi possível carregar os dados de usuário.', 'error');
        return;
    }

    const usersFromDB = settingsSnap.data().users || [];
    const userIndex = usersFromDB.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
        showModal('Erro', 'Usuário não encontrado.', 'error');
        return;
    }
    
    const user = usersFromDB[userIndex];
    
    if (user.username === ADMIN_PRINCIPAL_EMAIL) {	
        showModal('Permissões Fixas', 'As permissões do usuário Administrador principal são fixas e não podem ser alteradas.', 'warning');
        return;
    }

    const currentPerms = user.permissions || { dashboard: true, cadastro: true, pesquisa: true, settings: false };
    const allTabs = [
        { id: 'dashboard', name: 'Dashboard' }, { id: 'cadastro', name: 'Cadastro' },
        { id: 'pesquisa', name: 'Pesquisa' }, { id: 'settings', name: 'Configurações' }
    ];

    const checkboxesHTML = allTabs.map(tab => `
        <div class="flex items-center">
            <input id="perm-${tab.id}-${user.id}" type="checkbox" ${currentPerms[tab.id] ? 'checked' : ''} class="h-4 w-4 text-green-main border-gray-300 dark:border-gray-600 rounded focus:ring-green-main dark:bg-gray-700" ${tab.id === 'settings' && user.role !== 'admin' ? 'disabled' : ''}>
            <label for="perm-${tab.id}-${user.id}" class="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                ${tab.name} 
                ${tab.id === 'settings' && user.role !== 'admin' ? '<span class="text-xs text-red-500 dark:text-red-400">(Admin-Only)</span>' : ''}
            </label>
        </div>
    `).join('');

    const modal = document.getElementById('global-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    // Remove a classe 'max-w-sm' do modal principal para permitir mais espaço
    modal.querySelector('div').classList.remove('max-w-sm');
    modal.querySelector('div').classList.add('max-w-lg'); 

    titleEl.textContent = `Permissões de ${user.name}`;
    messageEl.innerHTML = `
        <p class="text-sm text-gray-600 dark:text-gray-300 mb-4">Selecione as abas que este usuário pode acessar.</p>
        <div class="space-y-2">${checkboxesHTML}</div>
    `;
    titleEl.className = `text-xl font-bold mb-3 text-gray-800 dark:text-gray-100`;	

    // CORREÇÃO: Remove o botão duplicado e garante que o botão "Cancelar" com a função de fechamento esteja anexado.
    actionsEl.innerHTML = `
        <button onclick="hideModal(); document.getElementById('global-modal').querySelector('div').classList.remove('max-w-lg'); document.getElementById('global-modal').querySelector('div').classList.add('max-w-sm');"
                class="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 shadow-md">Cancelar</button>
        <button id="confirm-action-btn" class="px-3 py-1.5 text-sm bg-green-main text-white rounded-lg hover:bg-green-700 shadow-md">Salvar</button>
    `;
    
    document.getElementById('confirm-action-btn').onclick = async () => {
        const newPermissions = {};
        allTabs.forEach(tab => {
            const checkbox = document.getElementById(`perm-${tab.id}-${user.id}`);	
            if (checkbox) newPermissions[tab.id] = checkbox.checked;
        });
        
        usersFromDB[userIndex].permissions = newPermissions;
        
        try {
            // [CORREÇÃO] Usa appId hardcoded
            await setDoc(settingsDocRef, { users: usersFromDB }, { merge: true });
            hideModal();
            // Retorna o modal ao tamanho padrão
            document.getElementById('global-modal').querySelector('div').classList.remove('max-w-lg');
            document.getElementById('global-modal').querySelector('div').classList.add('max-w-sm');
            showModal('Sucesso', `Permissões de ${user.name} atualizadas.`, 'success');
            // Se estiver editando as próprias permissões, forçamos um novo check de Auth e render
            if (currentUser.id === userId) {
                currentUser.permissions = newPermissions;
                handleHashChange();
            } else {
                renderApp();	
            }
        } catch (e) {
            showModal('Erro', 'Não foi possível salvar as permissões.', 'error');
        }
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}


// --- Funções Principais de Inicialização e Renderização ---

function handleHashChange() {
    if (!isAuthReady) return;	

    const hash = window.location.hash.substring(1);
    const parts = hash.split('/');
    const targetPage = parts[0] || (currentUser ? 'dashboard' : 'login');
    const subTab = parts.length > 1 ? parts[1] : null;
    
    if (targetPage === 'login' && currentUser) {
        window.history.pushState(null, null, `#${currentPage}`);
        return;
    }
    if (targetPage !== 'login' && !currentUser) {
        updateState('page', 'login');
        return;
    }
    
    // Permissão para Dashboard, Cadastro, Pesquisa, e Settings (se for admin)
    const isSettingsAdminPage = targetPage === 'settings';
    const canAccessTargetPage = !currentUser || targetPage === 'login' || currentUser.role === 'admin' || (currentUser.permissions && currentUser.permissions[targetPage]);

    if (isSettingsAdminPage && currentUser.role !== 'admin') {
         showModal('Acesso Negado', 'Você não tem permissão para acessar a página de Configurações.', 'error');
         window.history.pushState(null, null, `#${currentPage}`);	
         return;
    }
    
    if (!canAccessTargetPage) {
        showModal('Acesso Negado', 'Você não tem permissão para acessar esta página.', 'error');
        window.history.pushState(null, null, `#${currentPage}`);	
        return;
    }

    if (targetPage && targetPage !== currentPage) {
        updateState('page', targetPage);
    }	
    else if (targetPage === 'cadastro' && subTab && subTab !== currentCadastroTab) {
        updateState('cadastroTab', subTab);
    } else if (targetPage === 'cadastro' && !subTab && currentCadastroTab !== 'radio') {
        updateState('cadastroTab', 'radio');
    }
    else if (targetPage === 'settings' && subTab && subTab !== currentSettingTab) {
        updateState('settingTab', subTab);
    } else if (targetPage === 'settings' && !subTab && currentSettingTab !== 'system') {
        // Se não houver sub-aba e estiver em settings, forçamos para "Mapeamento"
        updateState('settingTab', 'system');
    }	
    else {
        renderApp();	
    }
}

// 🌟 NOVO: Tempo mínimo de exibição do splash screen (2 segundos)
const MIN_SPLASH_TIME = 2000;
let splashStart = 0;

function setupAuthListener() {
    loadDataCache();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            splashStart = Date.now();
            isLoggingIn = true;
            renderApp();
            userId = user.uid;

            await loadInitialSettings();

            let appUser = settings.users.find(u => u.username === user.email);

            // Leitura fresca direto do Firestore (caso loadInitialSettings tenha dados desatualizados)
            if (!appUser) {
                try {
                    const settingsDocRef = doc(db, "artifacts", appId, "public", "data", "settings", "config");
                    const freshSnap = await getDoc(settingsDocRef);
                    if (freshSnap.exists()) {
                        const freshUsers = freshSnap.data().users || [];
                        settings.users = freshUsers;
                        appUser = freshUsers.find(u => u.username === user.email);
                    }
                } catch (e) {
                    console.error("Leitura fresca de settings falhou:", e);
                }
            }

            // Contingência Admin Principal
            if (!appUser && user.email === ADMIN_PRINCIPAL_EMAIL) {
                appUser = {
                    id: user.uid,
                    name: "Juliano Timoteo (Admin Principal)",
                    username: ADMIN_PRINCIPAL_EMAIL,
                    role: "admin",
                    permissions: { dashboard: true, cadastro: true, pesquisa: true, settings: true }
                };
                if (!settings.users.some(u => u.username === ADMIN_PRINCIPAL_EMAIL)) {
                    settings.users.push(appUser);
                    saveSettings();
                }
            }

            // RECUPERAÇÃO: verifica na coleção users se o usuário tem perfil próprio
            if (!appUser) {
                try {
                    const userDocRef = doc(db, "artifacts", appId, "public", "data", "users", user.email);
                    const userSnap = await getDoc(userDocRef);
                    if (userSnap.exists()) {
                        const userData = userSnap.data();
                        appUser = {
                            id: userData.id || user.uid,
                            name: userData.name || user.email.split('@')[0],
                            username: user.email,
                            role: userData.role || 'user',
                            permissions: userData.permissions || { dashboard: true, cadastro: true, pesquisa: true, settings: false }
                        };
                        if (!settings.users.some(u => u.username === user.email)) {
                            settings.users.push(appUser);
                        }
                        console.log("Perfil recuperado de users para:", user.email);
                    }
                } catch (e) {
                    console.error("Leitura de users falhou:", e);
                }
            }

            // CRIAÇÃO: se não encontrou em nenhum lugar, tenta criar na coleção users
            if (!appUser) {
                try {
                    const newUser = {
                        id: crypto.randomUUID(),
                        name: user.email.split('@')[0] || user.email,
                        username: user.email,
                        role: 'user',
                        permissions: { dashboard: true, cadastro: true, pesquisa: true, settings: false }
                    };
                    const userDocRef = doc(db, "artifacts", appId, "public", "data", "users", user.email);
                    await setDoc(userDocRef, newUser);
                    settings.users.push(newUser);
                    appUser = newUser;
                    console.log("Perfil auto-criado em users para:", user.email);
                } catch (e) {
                    console.error("Falha ao criar perfil em users:", e);
                }
            }

            if (appUser) {
                currentUser = { ...appUser, uid: user.uid, email: user.email, customUsername: appUser.customUsername || null };
                isAuthReady = true;

                await attachFirestoreListeners();

                const elapsed = Date.now() - splashStart;
                const delay = Math.max(0, MIN_SPLASH_TIME - elapsed);

                setTimeout(() => {
                    isLoggingIn = false;
                    renderApp();
                    if (deferredPrompt) {
                        showInstallDialog();
                    }
                }, delay);
            } else {
                if (user.email) {
                    showModal('Acesso Não Autorizado', `Seu perfil (${user.email}) foi autenticado, mas não possui acesso aprovado no sistema. Contate um administrador.`, 'error');
                } else {
                    showModal('Erro', 'Falha na autenticação do perfil de acesso. Contate o suporte.', 'error');
                }
                if (auth.currentUser) await signOut(auth);
                isAuthReady = true;
                isLoggingIn = false;
                updateState('page', 'login');
            }
        } else {
            currentUser = null;
            userId = null;
            isAuthReady = true;
            isLoggingIn = false;
            detachFirestoreListeners();
            dbRadios = []; dbEquipamentos = []; dbBordos = []; dbRegistros = [];
            updateState('loginView', 'login');
            renderApp();
        }
    });
}


/**
 * [CORREÇÃO] Inicializa o Firebase com a constante hardcoded.
 */
function initApp() {
    try {
        // Usa a constante FIREBASE_CONFIG hardcoded
        app = initializeApp(FIREBASE_CONFIG);
        auth = getAuth(app);
        db = getFirestore(app);
        setLogLevel('info');    
        
        // --- Lógica Centralizada do PWA ---
        
        // 1. Listener para capturar o evento de instalação (antes que o Chrome mostre o dele)
        window.addEventListener('beforeinstallprompt', (e) => {
            // Previne que o mini-infobar nativo apareça no mobile imediatamente
            e.preventDefault();
            
            // Armazena o evento para ser disparado mais tarde pelo botão
            deferredPrompt = e;
            console.log("PWA: Evento 'beforeinstallprompt' capturado. Instalação disponível.");

            // Verifica se o usuário já está logado para mostrar o modal imediatamente
            // (Apenas se ainda não estiver instalado/dismissed)
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
            const dismissed = localStorage.getItem(PWA_PROMPT_KEY);

            if (!isStandalone && dismissed !== 'installed' && dismissed !== 'dismissed') {
                if (currentUser) {
                    showInstallDialog();
                }
            }
        });
        
        // 2. Listener para quando o app for instalado com sucesso
        window.addEventListener('appinstalled', () => {
             console.log("PWA: Aplicativo instalado com sucesso.");
             localStorage.setItem(PWA_PROMPT_KEY, 'installed');
             deferredPrompt = null;
             handlePwaPromptClose('install');
        });
        
        // [CORREÇÃO] O setupAuthListener agora chama loadInitialSettings antes do onAuthStateChanged
        setupAuthListener(); 

    } catch (e) {
        console.error("Erro crítico ao inicializar Firebase:", e);
        const appRoot = document.getElementById('app');
        if (appRoot) {
            appRoot.innerHTML = `<div class="p-4 text-red-500 dark:text-red-400 font-semibold text-center">Erro crítico ao inicializar o Firebase. Verifique as configurações e a conexão.</div>`;
        }
    }
}

// Adiciona rótulos (data-label) às células para o modo card no mobile
function applyResponsiveTableLabels(scope) {
    (scope || document).querySelectorAll('table.data-table').forEach(table => {
        const heads = Array.from(table.querySelectorAll('thead th')).map(th => (th.textContent || '').trim());
        if (!heads.length) return;
        table.querySelectorAll('tbody tr').forEach(tr => {
            Array.from(tr.children).forEach((td, i) => {
                if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] || '');
            });
        });
    });
}

let __swRegistered = false;
function registerServiceWorkerOnce() {
    if (__swRegistered || !('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    __swRegistered = true;
    const swUrl = new URL('service-worker.js', document.baseURI).href;
    navigator.serviceWorker.register(swUrl)
        .then(() => console.log('Service Worker registrado'))
        .catch(e => console.warn('Falha ao registrar SW', e));
}

function renderApp() {
    const root = document.getElementById('app');
    
    // CORREÇÃO CRÍTICA DE SEGURANÇA: Se o elemento raiz não existe, saia imediatamente.
   if (!root) {
        console.warn("Elemento raiz '#app' não encontrado. O renderApp será interrompido.");
        return; 
    }    
    let contentHTML = '';

    if (isLoggingIn) {
        contentHTML = renderLoadingScreen();
    } else if (currentUser) {
        contentHTML += renderTopBar();
        contentHTML += '<main class="fade-in-up">';
        
        const canAccessCurrentPage = currentUser.role === 'admin' || (currentUser.permissions && currentUser.permissions[currentPage]);

        // Se a página for settings e o usuário não for admin, volta para dashboard
        if (currentPage === 'settings' && currentUser.role !== 'admin') {
            currentPage = 'dashboard';
            window.location.hash = '#dashboard';
            contentHTML += renderDashboard();
        } 
        // Se a página não for acessível (baseado nas permissões)
        else if (!canAccessCurrentPage && currentPage !== 'login') {
            showModal('Acesso Negado', 'Você não tem permissão para acessar esta página.', 'error');
            currentPage = 'dashboard';
            window.location.hash = '#dashboard';
            contentHTML += renderDashboard();
        } else {
            switch (currentPage) {
                case 'dashboard': contentHTML += renderDashboard(); break;
                case 'cadastro': contentHTML += renderCadastro(); break;
                case 'pesquisa': contentHTML += renderPesquisa(); break;
                case 'settings': contentHTML += renderSettings(); break;
                default:
                    currentPage = 'dashboard';
                    window.location.hash = '#dashboard';
                    contentHTML += renderDashboard();   
            }
        }
        contentHTML += '</main><div class="mobile-nav__spacer" aria-hidden="true"></div>';
    } else if (isAuthReady) {
        currentPage = 'login';
        contentHTML += renderLogin();
    } else {
        contentHTML = renderLoadingScreen();
    }

    root.innerHTML = contentHTML;
    applyResponsiveTableLabels(root);
    root.querySelectorAll('.tabs .is-active, .tabs .tab-active').forEach(el => {
        try { el.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (_) {}
    });

    if (focusedSearchInputId) {
        const el = document.getElementById(focusedSearchInputId);
        if (el) {
            el.focus();
            el.setSelectionRange(searchCursorPosition, searchCursorPosition);
        }
    }

    registerServiceWorkerOnce();

    // Anexa eventos
    if (!isLoggingIn) {
        if (currentPage === 'login' && isAuthReady && !currentUser) {
            attachLoginEvents();
        } else if (currentUser) {
            if (currentPage === 'cadastro') attachCadastroEvents();
            if (currentPage === 'pesquisa') attachPesquisaEvents();
            // [CORREÇÃO] Chamada da função de eventos principal
            if (currentPage === 'settings') attachSettingsEvents();
            
            // Tenta mostrar o dialog de instalação se estiver pendente e o usuário acabou de entrar
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
            const dismissed = localStorage.getItem(PWA_PROMPT_KEY);
            
            if (!isStandalone && dismissed !== 'installed' && dismissed !== 'dismissed' && deferredPrompt) {
                 showInstallDialog();
            }
        }
    }
    
    // Renderiza conteúdo de usuários após a renderização principal (porque é assíncrono)
    if (currentUser && currentPage === 'settings' && currentSettingTab === 'users' && currentUser.role === 'admin') {
        renderSettingsUsers().then(html => {
            const settingsContent = document.getElementById('settings-content');
            if (settingsContent) {
                 // Evita re-renderizar se a aba mudou rapidamente
                 if (currentSettingTab === 'users') {
                     settingsContent.innerHTML = html;
                     attachSettingsUsersEvents();
                 }
            }
        });
    }
}

// Funções para Modais
function showModal(title, message, type = 'info', maxWidth = 'max-w-lg') {
    const modal = document.getElementById('global-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    // Aplica o tamanho do modal
    modal.querySelector('div').classList.remove('max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl', 'max-w-4xl', 'max-w-5xl');
    modal.querySelector('div').classList.add(maxWidth);

    titleEl.textContent = title;
    messageEl.innerHTML = message.replace(/\n/g, '<br>');
    
    let titleClass = 'text-gray-800 dark:text-gray-100';
    if (type === 'success') titleClass = 'text-green-main';
    if (type === 'error') titleClass = 'text-red-600 dark:text-red-400';
    if (type === 'warning') titleClass = 'text-yellow-600 dark:text-yellow-400';
    if (type === 'info') titleClass = 'text-blue-600 dark:text-blue-400'; 
    titleEl.className = `text-xl font-bold mb-3 ${titleClass}`;

    actionsEl.innerHTML = `
        <button onclick="hideModal()" class="px-3 py-1.5 text-sm bg-green-main text-white font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-md">
            OK
        </button>
    `;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function showConfirmModal(title, message, callback) {
    const modal = document.getElementById('global-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const actionsEl = document.getElementById('modal-actions');

    // Volta o tamanho do modal para o padrão
    modal.querySelector('div').classList.remove('max-w-lg', 'max-w-md', 'max-w-xl');
    modal.querySelector('div').classList.add('max-w-sm');

    titleEl.textContent = title;
    messageEl.innerHTML = message.replace(/\n/g, '<br>');
    titleEl.className = `text-xl font-bold mb-3 text-red-600 dark:text-red-400`;	

    actionsEl.innerHTML = `
        <button onclick="hideModal()" class="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors shadow-md">
            Cancelar
        </button>
        <button id="confirm-action-btn" class="px-3 py-1.5 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-md">
            Confirmar
        </button>
    `;
    
    document.getElementById('confirm-action-btn').onclick = () => {
        hideModal();
        callback();	
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function hideModal() {
    document.getElementById('global-modal').classList.add('hidden');
    document.getElementById('global-modal').classList.remove('flex');
}

// Funções de Perfil
function showProfileModal() {
    renderProfileModalContent();
    document.getElementById('profile-modal').classList.remove('hidden');
    document.getElementById('profile-modal').classList.add('flex');
}

function hideProfileModal() {
    document.getElementById('profile-modal').classList.add('hidden');
    document.getElementById('profile-modal').classList.remove('flex');
}

function renderProfileModalContent() {
    const modalContent = document.getElementById('profile-modal-content');
    if (!currentUser) {
        modalContent.innerHTML = '<p class="text-red-500 dark:text-red-400">Erro: Usuário não logado.</p>';
        return;
    }
    
    // Layout centralizado para dispositivos móveis
    modalContent.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-gray-50 dark:bg-gray-900 p-4 rounded-xl shadow-inner border border-gray-200 dark:border-gray-700">
                <h4 class="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center">
                    <i class="fas fa-user-edit mr-2 text-green-main"></i> Gerenciar Nome
                </h4>
                <p class="text-xs text-gray-600 dark:text-gray-300 mb-3">
                    Altere o nome que aparece na barra superior.
                </p>
                <form id="form-personal-name" class="space-y-3">
                    <div>
                        <label for="profile-name" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Nome de Exibição Atual</label>
                        <input type="text" id="profile-name" required value="${currentUser.name}"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-green-main focus:ring-green-main p-2 border text-sm dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <button type="submit" class="btn btn--primary btn--block">
                        <i class="fas fa-save mr-2"></i> Salvar Nome
                    </button>
                </form>
                <div class="mt-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-700 dark:text-gray-300 break-words-all">
                    <p><span class="font-semibold">Seu Login Principal:</span> ${currentUser.customUsername || currentUser.email}</p>
                    <p><span class="font-semibold">Seu Perfil:</span> ${currentUser.role.toUpperCase()}</p>
                </div>
            </div>
            
            <div class="bg-gray-50 dark:bg-gray-900 p-4 rounded-xl shadow-inner border border-red-200 dark:border-red-700">
                <h4 class="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center">
                    <i class="fas fa-key mr-2 text-red-600"></i> Alterar Senha
                </h4>
                <p class="text-xs text-red-600 dark:text-red-400 mb-3">
                    A nova senha deve ter no mínimo 6 caracteres.
                </p>
                <form id="form-change-password" class="space-y-3">
                    <div>
                        <label for="profile-new-password" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Nova Senha</label>
                        <input type="password" id="profile-new-password" required minlength="6"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-red-500 focus:ring-red-500 p-2 border text-sm dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <div>
                        <label for="profile-confirm-password" class="block text-sm font-medium text-gray-700 dark:text-gray-300">Confirmar Nova Senha</label>
                        <input type="password" id="profile-confirm-password" required minlength="6"
                            class="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-red-500 focus:ring-red-500 p-2 border text-sm dark:bg-gray-700 dark:text-gray-100">
                    </div>
                    <button type="submit" class="w-full flex justify-center py-2 px-3 border border-transparent text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 shadow-md">
                        <i class="fas fa-lock mr-2"></i> Alterar Senha
                    </button>
                </form>
            </div>
        </div>
    `;
    // Anexa eventos ao modal
    document.getElementById('form-personal-name').onsubmit = savePersonalName;
    document.getElementById('form-change-password').onsubmit = changePassword;
}

// Funções de Duplicidades
function showDuplicityModal() {
    renderDuplicityModalContent();
    document.getElementById('duplicity-modal').classList.remove('hidden');
    document.getElementById('duplicity-modal').classList.add('flex');
}

function hideDuplicityModal() {
    document.getElementById('duplicity-modal').classList.add('hidden');
    document.getElementById('duplicity-modal').classList.remove('flex');
}

// Wrapper para exclusão que usa o modal de confirmação global
function deleteDuplicityWrapper(collection, id, value) {
    let type;
    if (collection === 'radios') type = 'Rádio (Série)';
    else if (collection === 'equipamentos') type = 'Equipamento (Frota)';
    else if (collection === 'bordos') type = 'Bordo (Tipo/Série)';
    else type = 'Registro';

    showConfirmModal('Confirmar Exclusão de Duplicidade', 
        `Deseja **EXCLUIR PERMANENTEMENTE** o registro duplicado de ${type}: <b>${value}</b>?`, 
        () => deleteDuplicity(collection, id)
    );
}

// Localize esta função no final do app.main.js
// app.main.js - Função processImportedData (CORRIGIDA)

async function processImportedData(collectionName, data) {
    if (!db || !appId) {
        showModal('Erro', 'Conexão com o banco de dados perdida.', 'error');
        return;
    }

    const newRecords = [];
    let currentDb = collectionName === 'radios' ? dbRadios : (collectionName === 'equipamentos' ? dbEquipamentos : dbBordos);
    let ignoredCount = 0;
    
    // NOVO: Lista para checar duplicidades DENTRO do próprio arquivo de importação
    const keysBeingImported = new Set(); 

    for (const item of data) {
        let record = { createdAt: new Date().toISOString(), ativo: true };
        let keyToValidate = ''; // Chave única: Número de Série ou Frota ou Tipo+Série

        if (collectionName === 'radios') {
            const serie = item['Numero de Serie'] || item['NumeroSerie'] || item['serie'];
            const modelo = item['Modelo'] || item['Modelo de Rádio'] || item['modelo'];
            
            if (!serie || !modelo) continue;
            
            record.serie = String(serie).trim();
            record.modelo = String(modelo).trim();
            record.status = 'Disponível';	
            keyToValidate = record.serie; // Duplicidade por Série
            
            // 1. Checagem de duplicidade no banco de dados
            const isDbDuplicate = currentDb.some(r => r.serie === keyToValidate);
            
            // 2. Checagem de duplicidade DENTRO do arquivo
            const isFileDuplicate = keysBeingImported.has(keyToValidate);

            if (isDbDuplicate || isFileDuplicate) {
                 ignoredCount++;
                 continue;
            }
            keysBeingImported.add(keyToValidate);

        } else if (collectionName === 'equipamentos') {
            const frota = item['Frota'];
            const grupo = item['Grupo'];
            const modeloEq = item['Modelo do Equipamento'] || item['Modelo Equipamento'];
            const subgrupo = item['Subgrupo'] || item['Descricao do Equipamento'] || item['Descricao Equipamento'];
            const gestor = item['Gestor'] || 'Sem Gestor';
            
            // Validação de campos obrigatórios e grupo
            if (!frota || !grupo || !modeloEq || !subgrupo || !GROUPS.includes(String(grupo).trim())) {
                console.warn('Registro de equipamento inválido ou incompleto:', item);
                continue;
            }

            record.frota = String(frota).trim();
            record.grupo = String(grupo).trim();
            record.modelo = String(modeloEq).trim();
            record.subgrupo = String(subgrupo).trim();	
            record.gestor = String(gestor).trim();
            keyToValidate = record.frota; // Duplicidade por Frota
            
             // 1. Checagem de duplicidade no banco de dados
            const isDbDuplicate = currentDb.some(e => e.frota === keyToValidate);

            // 2. Checagem de duplicidade DENTRO do arquivo
            const isFileDuplicate = keysBeingImported.has(keyToValidate);

            if (isDbDuplicate || isFileDuplicate) {
                 ignoredCount++;
                 continue;
            }
            keysBeingImported.add(keyToValidate);

        } else if (collectionName === 'bordos') {
            const tipo = item['Tipo'] || item['tipo'];
            const numeroSerie = item['Numero de Serie'] || item['NumeroSerie'] || item['numeroSerie'];
            const modelo = item['Modelo'] || item['modelo'];

            if (!tipo || !numeroSerie || !modelo || !TIPOS_BORDO.includes(String(tipo).trim())) continue;

            record.tipo = String(tipo).trim();
            record.numeroSerie = String(numeroSerie).trim();
            record.modelo = String(modelo).trim();
            record.status = 'Disponível';
            
            keyToValidate = `${record.tipo}-${record.numeroSerie}`; // Duplicidade por Tipo+Série

            
            // 1. Checagem de duplicidade no banco de dados
            const isDbDuplicate = currentDb.some(b => 
                b.tipo === record.tipo && b.numeroSerie === record.numeroSerie
            );
            
            // 2. Checagem de duplicidade DENTRO do arquivo
            const isFileDuplicate = keysBeingImported.has(keyToValidate);

            if (isDbDuplicate || isFileDuplicate) {
                 ignoredCount++;
                 continue;
            }
            keysBeingImported.add(keyToValidate);

        } else {
            // Ignora coleção desconhecida
            continue;
        }
        
        newRecords.push(record);
    }

    if (newRecords.length > 0) {
        // [CORREÇÃO] Usa appId hardcoded
        const colPath = `artifacts/${appId}/public/data/${collectionName}`;
        const colRef = collection(db, colPath);
        const batch = writeBatch(db);
        
        newRecords.forEach(record => {
            const newDocRef = doc(colRef);	
            batch.set(newDocRef, record);
        });

        try {
            await batch.commit();
            await refreshDataFromFirestore();
            let msg = `${newRecords.length} registros de ${collectionName} importados com sucesso.`;
            if (ignoredCount > 0) {
                msg += `<br>(${ignoredCount} duplicatas de Série/Frota/Tipo+Série ignoradas.)`;
            }
            showModal('Importação Concluída', msg, 'success');
        } catch (error) {
            showModal('Erro de Importação', 'Ocorreu um erro ao salvar os dados no banco de dados.', 'error');
        }
    } else {
        let msg = 'Nenhum registro novo válido foi encontrado no arquivo.';
        if (ignoredCount > 0) {
            msg += `<br>(${ignoredCount} duplicatas de Série/Frota/Tipo+Série ignoradas.)`;
        }
        showModal('Importação', msg, 'info');
    }
}

// -------------------------------------------------------------------------------------

// --- Inicialização ---

window.onhashchange = handleHashChange;

// EXPOSIÇÕES GLOBAIS DE FUNÇÕES ESSENCIAIS (CORREÇÃO DE ESCOPO)
window.showModal = showModal;
window.showConfirmModal = showConfirmModal;
window.hideModal = hideModal;
window.handleImport = handleImport; 
window.handleLogout = handleLogout; // Expondo handleLogout
window.handleSearchInput = handleSearchInput;
window.loadRadioForEdit = loadRadioForEdit;
window.loadEquipamentoForEdit = loadEquipamentoForEdit;
window.loadBordoForEdit = loadBordoForEdit; 
window.showPermissionModal = showPermissionModal;
window.renderApp = renderApp;	
window.updateState = updateState;	
window.deleteRecord = deleteRecord;	
window.deleteEquipamento = deleteEquipamento;
window.toggleRecordAtivo = toggleRecordAtivo; 
window.loadUserForEdit = loadUserForEdit;
window.deleteUser = deleteUser;
window.setRadioPage = setRadioPage;
window.setEquipamentoPage = setEquipamentoPage;
window.setBordosPage = setBordosPage; // 🌟 NOVO: Expondo paginação Bordos
window.setGeralPage = setGeralPage;
window.setPesquisaPage = setPesquisaPage; // 🌟 NOVO: Expondo paginação da pesquisa
window.abrirRelatorio = abrirRelatorio;
window.fecharRelatorio = fecharRelatorio;
window.radioAmadorBuscar = radioAmadorBuscar;
window.radioAmadorLimpar = radioAmadorLimpar;
window.showRadioAmadorModal = showRadioAmadorModal;
window.fecharRadioAmadorModal = fecharRadioAmadorModal;
window.radioModalBuscar = radioModalBuscar;
window.exportarCadastroJSON = exportarCadastroJSON;
window.handleSolicitarAcesso = handleSolicitarAcesso; 

// Mini relatório de rádios disponíveis (Dashboard)
function showRadiosDisponiveis() {
    if (!dbRadios || dbRadios.length === 0) {
        showModal('Rádios Disponíveis', 'Nenhum rádio disponível no momento.', 'info');
        return;
    }
    const disponiveis = dbRadios.filter(r => r.ativo !== false && r.status === 'Disponível');
    if (disponiveis.length === 0) {
        showModal('Rádios Disponíveis', 'Nenhum rádio disponível no momento.', 'info');
        return;
    }
    const modelCount = {};
    disponiveis.forEach(r => {
        const m = r.modelo || 'Sem modelo';
        modelCount[m] = (modelCount[m] || 0) + 1;
    });
    const listHtml = Object.entries(modelCount)
        .sort((a, b) => b[1] - a[1])
        .map(([modelo, qtd]) =>
            `<div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <span class="text-gray-800 dark:text-gray-100 font-medium">${modelo}</span>
                <span class="text-green-main font-bold text-lg">${qtd}</span>
            </div>`
        ).join('');
    showModal(`Rádios Disponíveis (${disponiveis.length})`,
        `<div class="space-y-1">${listHtml}</div>`, 'success');
}
window.showRadiosDisponiveis = showRadiosDisponiveis;

window.showProfileModal = showProfileModal;
window.hideProfileModal = hideProfileModal;
window.getUserAvatar = getUserAvatar; // Expondo getUserAvatar

// EXPOSIÇÕES DO SISTEMA DE INTEGRIDADE
window.showDuplicityModal = showDuplicityModal;
window.hideDuplicityModal = hideDuplicityModal;
window.deleteDuplicity = deleteDuplicity;
window.deleteDuplicityWrapper = deleteDuplicityWrapper;

// Exposições de wrappers para modal de aprovação
window.approveUserWrapper = approveUserWrapper;
window.rejectUserWrapper = rejectUserWrapper;
window.renderPendingApprovalsModal = renderPendingApprovalsModal;

// Expondo as novas funções do modal de perfil (para uso no formulário)
window.savePersonalName = savePersonalName;
window.changePassword = changePassword;

function handleImportVinculos(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    showConfirmModal(
        '⚠ Sobrescrever todos os dados?',
        `<p class="text-sm text-gray-700 dark:text-gray-300">A importação <strong>apagará todos os registros atuais</strong> de vínculos, rádios, bordos e equipamentos, substituindo-os pelos dados da planilha.</p>
         <p class="mt-2 text-sm text-red-600 dark:text-red-400 font-semibold">Esta ação não pode ser desfeita. Deseja continuar?</p>`,
        async () => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const data = e.target.result;
                if (file.name.endsWith('.csv')) {
                    Papa.parse(data, { header: true, skipEmptyLines: true,
                        complete: function(results) { processImportVinculosOverwrite(results.data); }
                    });
                } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                    const wb = XLSX.read(data, { type: 'binary' });
                    processImportVinculosOverwrite(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
                } else {
                    showModal('Erro', 'Formato não suportado. Use CSV ou XLSX.', 'error');
                }
            };
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) reader.readAsBinaryString(file);
            else reader.readAsText(file);
        }
    );
}

async function processImportVinculosOverwrite(rows) {
    if (!db || !appId) { showModal('Erro', 'Conexão com o banco de dados perdida.', 'error'); return; }
    if (!rows || rows.length === 0) { showModal('Aviso', 'O arquivo está vazio.', 'warning'); return; }

    const totalRows = rows.length;
    const colEquip     = `artifacts/${appId}/public/data/equipamentos`;
    const colRadios    = `artifacts/${appId}/public/data/radios`;
    const colBordos    = `artifacts/${appId}/public/data/bordos`;
    const colRegistros = `artifacts/${appId}/public/data/registros`;

    const colecoes = [
        { path: colRegistros, label: 'Registros' },
        { path: colBordos,    label: 'Bordos' },
        { path: colRadios,    label: 'Rádios' },
        { path: colEquip,     label: 'Equipamentos' },
    ];

    try {
        showProgressModal('Importando Vínculos',
            `<p class="text-sm text-gray-600 dark:text-gray-300">Preparando importação de <strong>${totalRows}</strong> linha(s)...</p>`
        );

        for (let c = 0; c < colecoes.length; c++) {
            const { path: colPath, label } = colecoes[c];
            const pct = Math.round(((c) / colecoes.length) * 20);
            updateImportProgress(
                `<p class="text-sm text-gray-600 dark:text-gray-300">Limpando <strong>${label}</strong> antigos...</p>`,
                pct
            );
            const snap = await getDocs(collection(db, colPath));
            const batches = [];
            let b = writeBatch(db), count = 0;
            snap.forEach(d => {
                b.delete(d.ref); count++;
                if (count >= 490) { batches.push(b); b = writeBatch(db); count = 0; }
            });
            if (count > 0) batches.push(b);
            for (const batch of batches) await batch.commit();
        }

        // Limpar estado local antes de reimportar
        dbRegistros = []; dbRadios = []; dbBordos = []; dbEquipamentos = [];

        await processImportVinculos(rows);
    } catch (err) {
        console.error('Erro ao sobrescrever dados:', err);
        showModal('Erro', 'Falha ao limpar os dados existentes. Tente novamente.', 'error');
    }
}

function downloadModeloVinculos() {
    const headers = ['Código', 'Frota', 'Série Rádio', 'Modelo Rádio', 'Grupo', 'Tela', 'Modelo Tela', 'Mag', 'Modelo Mag', 'Chip', 'Gestor'];
    const exemplo = [
        'COD-001', '8001', 'SN12345', 'EM200', 'Colheita', 'T-001', 'TELA X', 'M-001', 'MAG Y', 'CHIP-001', 'João Silva'
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, exemplo]);
    ws['!cols'] = [12, 10, 14, 12, 14, 12, 12, 12, 12, 14, 16].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, 'Vínculos');
    XLSX.writeFile(wb, 'modelo_vinculos.xlsx');
}

// 🌟 CORREÇÃO DE ERROS DE REFERÊNCIA: Expondo as constantes de Tooltip e Tema
window.RADIO_IMPORT_INFO = RADIO_IMPORT_INFO;
window.EQUIPAMENTO_IMPORT_INFO = EQUIPAMENTO_IMPORT_INFO;
window.BORDO_IMPORT_INFO = BORDO_IMPORT_INFO; // 🌟 NOVO: Expondo constante de Bordo
window.VINCULO_IMPORT_INFO = VINCULO_IMPORT_INFO;
window.handleImportVinculos = handleImportVinculos;
window.downloadModeloVinculos = downloadModeloVinculos;
window.toggleTheme = toggleTheme;


window.deleteLink = deleteLink;
window.deleteDuplicity = deleteDuplicity;
window.deleteDuplicityWrapper = (collectionName, id, value) => {
    showConfirmModal('Confirmar Exclusão', `Deseja realmente excluir esta duplicidade (${value})?`, () => deleteDuplicity(collectionName, id));
};
//  NOVO: Expor função para escopo global (agora é o modal)
window.showVincularModal = showVincularModal;
window.hideVincularModal = hideVincularModal; 
// 🛑 handleDesvincularBordoIndividual NÃO É MAIS NECESSÁRIO como função separada no HTML
// --- Inicialização do Sistema ---
window.onload = initApp;
