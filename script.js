/* ===================================================================
   SID CONSERTOS — Controle de Chamadas
   Lógica do aplicativo (vanilla JS, localStorage, sem backend)
   =================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------
     CONSTANTES / CHAVES DE ARMAZENAMENTO
  --------------------------------------------------------------- */
  const STORAGE_KEY = 'sidConsertos_chamadas_v1';
  const THEME_KEY = 'sidConsertos_tema';

  const BRANDS = ['Electrolux','Brastemp','Consul','Samsung','LG','Panasonic','Midea','Colormaq','Mueller','Suggar','Philco','Outra'];

  const STATUS_LIST = ['Pendente','Agendado','Em andamento','Aguardando peça','Aguardando aprovação','Retorno necessário','Concluído','Cancelado'];

  /* ---------------------------------------------------------------
     ESTADO EM MEMÓRIA
  --------------------------------------------------------------- */
  let calls = [];               // todas as chamadas
  let editingId = null;         // id da chamada em edição (null = nova)
  let pecasRows = [];           // linhas de peças trocadas no formulário atual
  let detailCallId = null;      // id da chamada aberta na tela de detalhe
  let confirmCallback = null;   // callback do dialog de confirmação genérico
  let currentListView = 'cards';

  // --- Sincronização em nuvem (Supabase) ---
  const CLOUD_TABLE = 'chamadas';
  let sb = null;                // cliente Supabase (null = sem sincronização configurada)

  /* ---------------------------------------------------------------
     UTILITÁRIOS
  --------------------------------------------------------------- */
  function uid() {
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset();
    const local = new Date(d.getTime() - tz * 60000);
    return local.toISOString().slice(0, 10);
  }

  function formatDateBR(iso) {
    if (!iso) return '—';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function formatCurrency(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function parseNumber(value) {
    const n = parseFloat(value);
    return isNaN(n) ? 0 : n;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugStatus(status) {
    return String(status || '').replace(/\s+/g, '-');
  }

  function showToast(message, isError) {
    const toast = document.getElementById('toast');
    toast.innerHTML = `<i class="fa-solid ${isError ? 'fa-circle-xmark' : 'fa-circle-check'}"></i><span>${escapeHtml(message)}</span>`;
    toast.classList.toggle('error', !!isError);
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  /* ---------------------------------------------------------------
     ARMAZENAMENTO (localStorage)
  --------------------------------------------------------------- */
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      calls = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(calls)) calls = [];
    } catch (e) {
      console.error('Erro ao carregar dados do localStorage', e);
      calls = [];
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(calls));
      return true;
    } catch (e) {
      console.error('Erro ao salvar no localStorage', e);
      showToast('Não foi possível salvar. Armazenamento cheio ou indisponível.', true);
      return false;
    }
  }

  function generateNumero() {
    let maxN = 0;
    calls.forEach(c => {
      const m = /^SC-(\d+)$/.exec(c.numero || '');
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    });
    return 'SC-' + String(maxN + 1).padStart(4, '0');
  }

  /* ---------------------------------------------------------------
     MODELO DE DADOS PADRÃO DE UMA CHAMADA
  --------------------------------------------------------------- */
  function blankCall() {
    return {
      id: uid(),
      numero: generateNumero(),
      data: todayISO(),
      horario: '',
      tipoAtendimento: 'Visita técnica',
      status: 'Pendente',

      cliente: {
        nome: '', telefone: '', endereco: '', numero: '', complemento: '',
        bairro: '', cidade: '', estado: '', cep: ''
      },

      maquina: {
        marca: 'Electrolux', marcaOutra: '', modelo: '', tipo: 'Lavadora',
        capacidade: '', voltagem: 'Não informado', numeroSerie: '', tempoUso: ''
      },

      reclamacao: '',
      sintomas: [],
      sintomaOutro: '',
      diagnostico: '',
      testes: [],
      testesObs: '',

      orcamento: {
        valorVisita: 0, valorMaoDeObra: 0, valorPecas: 0, desconto: 0, valorTotal: 0,
        situacao: 'Não informado', motivoRecusa: ''
      },

      servicoRealizado: '',
      pecas: [],
      pecasNecessarias: '',
      resultadoFinal: '',

      retorno: {
        precisa: 'Não', data: '', motivo: '', observacao: ''
      },

      garantia: {
        periodo: 'Sem garantia', dataInicio: '', dataFim: '', dentroGarantia: 'Não'
      },

      obsGerais: '',
      anotacoesInternas: '',

      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    };
  }

  /* ---------------------------------------------------------------
     DASHBOARD — ESTATÍSTICAS
  --------------------------------------------------------------- */
  function computeStats() {
    const today = todayISO();
    const startOfWeek = getStartOfWeek();
    const total = calls.length;
    const hoje = calls.filter(c => c.data === today).length;
    const pendentes = calls.filter(c => c.status === 'Pendente').length;
    const andamento = calls.filter(c => c.status === 'Em andamento').length;
    const concluidas = calls.filter(c => c.status === 'Concluído').length;
    const retornos = calls.filter(c => c.retorno && c.retorno.precisa === 'Sim').length;
    return { total, hoje, pendentes, andamento, concluidas, retornos };
  }

  function getStartOfWeek() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day;
    const start = new Date(d.setDate(diff));
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function renderStats() {
    const s = computeStats();
    const cards = [
      { icon: 'fa-layer-group', label: 'Total de chamadas', value: s.total, color: 'var(--accent-2)' },
      { icon: 'fa-calendar-day', label: 'Chamadas hoje', value: s.hoje, color: 'var(--accent)' },
      { icon: 'fa-hourglass-half', label: 'Pendentes', value: s.pendentes, color: 'var(--accent)' },
      { icon: 'fa-screwdriver-wrench', label: 'Em andamento', value: s.andamento, color: 'var(--accent-2)' },
      { icon: 'fa-circle-check', label: 'Concluídas', value: s.concluidas, color: 'var(--success)' },
      { icon: 'fa-rotate-left', label: 'Retornos agendados', value: s.retornos, color: '#9F7DE8' }
    ];
    document.getElementById('statsGrid').innerHTML = cards.map(c => `
      <div class="stat-card" style="--stat-color:${c.color}">
        <i class="fa-solid ${c.icon}"></i>
        <span class="stat-value">${c.value}</span>
        <span class="stat-label">${c.label}</span>
      </div>
    `).join('');
  }

  /* ---------------------------------------------------------------
     LISTAGEM — PESQUISA, FILTROS, RENDER
  --------------------------------------------------------------- */
  function getFilteredCalls() {
    const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    const status = document.getElementById('filterStatus').value;
    const marca = document.getElementById('filterMarca').value;
    const periodo = document.getElementById('filterPeriodo').value;
    const dateFrom = document.getElementById('filterDateFrom').value;
    const dateTo = document.getElementById('filterDateTo').value;

    let list = calls.slice();

    if (status) list = list.filter(c => c.status === status);
    if (marca) list = list.filter(c => (c.maquina.marca === marca) || (c.maquina.marca === 'Outra' && marca === 'Outra'));

    if (periodo) {
      const today = new Date(); today.setHours(0,0,0,0);
      list = list.filter(c => {
        if (!c.data) return false;
        const d = new Date(c.data + 'T00:00:00');
        if (periodo === 'hoje') {
          return c.data === todayISO();
        } else if (periodo === 'semana') {
          const start = getStartOfWeek();
          const end = new Date(start); end.setDate(end.getDate() + 7);
          return d >= start && d < end;
        } else if (periodo === 'mes') {
          return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
        } else if (periodo === 'ano') {
          return d.getFullYear() === today.getFullYear();
        } else if (periodo === 'personalizado') {
          if (dateFrom && c.data < dateFrom) return false;
          if (dateTo && c.data > dateTo) return false;
          return true;
        }
        return true;
      });
    }

    if (q) {
      list = list.filter(c => {
        const haystack = [
          c.numero, c.cliente.nome, c.cliente.telefone, c.maquina.marca, c.maquina.marcaOutra,
          c.maquina.modelo, c.reclamacao, c.diagnostico, c.servicoRealizado,
          c.cliente.endereco, c.cliente.cidade, c.cliente.bairro, c.status,
          (c.pecas || []).map(p => p.nome).join(' ')
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    list.sort((a, b) => (b.data + (b.horario||'')).localeCompare(a.data + (a.horario||'')) || (b.criadoEm||'').localeCompare(a.criadoEm||''));
    return list;
  }

  function populateMarcaFilter() {
    const sel = document.getElementById('filterMarca');
    const current = sel.value;
    sel.innerHTML = '<option value="">Todas</option>' + BRANDS.map(b => `<option value="${b}">${b}</option>`).join('');
    sel.value = current;
  }

  function renderList() {
    const list = getFilteredCalls();
    const cardsWrap = document.getElementById('callsCards');
    const tableBody = document.getElementById('callsTableBody');
    const empty = document.getElementById('emptyState');

    document.getElementById('callsCards').style.display = currentListView === 'cards' ? 'grid' : 'none';
    document.getElementById('callsTable').style.display = currentListView === 'table' ? 'table' : 'none';

    if (list.length === 0) {
      empty.style.display = 'flex';
      cardsWrap.innerHTML = '';
      tableBody.innerHTML = '';
      return;
    }
    empty.style.display = 'none';

    cardsWrap.innerHTML = list.map(c => {
      const marca = c.maquina.marca === 'Outra' ? (c.maquina.marcaOutra || 'Outra') : c.maquina.marca;
      const cidadeBairro = [c.cliente.bairro, c.cliente.cidade].filter(Boolean).join(' / ') || '—';
      return `
      <div class="call-card" data-id="${c.id}">
        <div class="call-card-top">
          <span class="call-num">${escapeHtml(c.numero)}</span>
          <span class="call-date">${formatDateBR(c.data)}</span>
        </div>
        <div class="call-client">${escapeHtml(c.cliente.nome || 'Cliente não informado')}</div>
        <div class="call-machine"><i class="fa-solid fa-washing-machine"></i> ${escapeHtml(marca)} ${escapeHtml(c.maquina.modelo || '')}</div>
        <div class="call-problem">${escapeHtml(c.reclamacao || 'Sem reclamação registrada.')}</div>
        <div class="call-card-bottom">
          <span class="status-badge status-${slugStatus(c.status)}">${escapeHtml(c.status)}</span>
          <span class="call-location"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(cidadeBairro)}</span>
        </div>
      </div>`;
    }).join('');

    tableBody.innerHTML = list.map(c => {
      const marca = c.maquina.marca === 'Outra' ? (c.maquina.marcaOutra || 'Outra') : c.maquina.marca;
      const cidadeBairro = [c.cliente.bairro, c.cliente.cidade].filter(Boolean).join(' / ') || '—';
      return `
      <tr data-id="${c.id}">
        <td class="call-num">${escapeHtml(c.numero)}</td>
        <td>${formatDateBR(c.data)}</td>
        <td>${escapeHtml(c.cliente.nome || '—')}</td>
        <td>${escapeHtml(marca)}</td>
        <td>${escapeHtml(c.maquina.modelo || '—')}</td>
        <td>${escapeHtml((c.reclamacao || '').slice(0, 40))}${(c.reclamacao||'').length > 40 ? '…' : ''}</td>
        <td><span class="status-badge status-${slugStatus(c.status)}">${escapeHtml(c.status)}</span></td>
        <td>${escapeHtml(cidadeBairro)}</td>
        <td><i class="fa-solid fa-chevron-right" style="color:var(--text-faint)"></i></td>
      </tr>`;
    }).join('');

    cardsWrap.querySelectorAll('.call-card').forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
    tableBody.querySelectorAll('tr').forEach(el => {
      el.addEventListener('click', () => openDetail(el.dataset.id));
    });
  }

  function refreshDashboard() {
    renderStats();
    renderList();
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — ABAS
  --------------------------------------------------------------- */
  const TAB_ORDER = ['tab-atendimento','tab-cliente','tab-maquina','tab-diagnostico','tab-orcamento','tab-servico','tab-retorno','tab-obs'];

  function goToTab(tabId) {
    document.querySelectorAll('.form-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.form-tab-panel').forEach(p => p.classList.toggle('active', p.id === tabId));
    document.getElementById('callForm').closest('.modal-body').scrollTop = 0;
    updateTabNavButtons(tabId);
  }

  function updateTabNavButtons(tabId) {
    const idx = TAB_ORDER.indexOf(tabId);
    document.getElementById('btnPrevTab').disabled = idx <= 0;
    document.getElementById('btnNextTab').disabled = idx >= TAB_ORDER.length - 1;
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — ABRIR / FECHAR
  --------------------------------------------------------------- */
  function openForm(callId) {
    editingId = callId || null;
    const call = editingId ? calls.find(c => c.id === editingId) : blankCall();
    if (!call) { showToast('Chamada não encontrada.', true); return; }

    document.getElementById('formModalTitle').textContent = editingId ? 'Editar chamada' : 'Nova chamada';
    document.getElementById('formModalNumero').textContent = call.numero;

    populateForm(call);
    goToTab('tab-atendimento');
    renderHistoricoCliente(call);
    document.getElementById('formModalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeForm() {
    document.getElementById('formModalOverlay').classList.remove('open');
    document.body.style.overflow = '';
    editingId = null;
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — PREENCHER CAMPOS A PARTIR DE UM OBJETO "call"
  --------------------------------------------------------------- */
  function populateForm(call) {
    const f = id => document.getElementById(id);

    f('f_numero').value = call.numero;
    f('f_data').value = call.data;
    f('f_horario').value = call.horario;
    f('f_tipoAtendimento').value = call.tipoAtendimento;
    f('f_status').value = call.status;

    f('f_clienteNome').value = call.cliente.nome;
    f('f_clienteTelefone').value = call.cliente.telefone;
    f('f_endereco').value = call.cliente.endereco;
    f('f_enderecoNumero').value = call.cliente.numero;
    f('f_complemento').value = call.cliente.complemento;
    f('f_bairro').value = call.cliente.bairro;
    f('f_cidade').value = call.cliente.cidade;
    f('f_estado').value = call.cliente.estado;
    f('f_cep').value = call.cliente.cep;

    f('f_marca').value = call.maquina.marca;
    f('f_marcaOutra').value = call.maquina.marcaOutra;
    toggleMarcaOutra();
    f('f_modelo').value = call.maquina.modelo;
    f('f_tipoMaquina').value = call.maquina.tipo;
    f('f_capacidade').value = call.maquina.capacidade;
    f('f_voltagem').value = call.maquina.voltagem;
    f('f_numeroSerie').value = call.maquina.numeroSerie;
    f('f_tempoUso').value = call.maquina.tempoUso;

    f('f_reclamacao').value = call.reclamacao;
    document.querySelectorAll('#sintomasGroup input[type=checkbox]').forEach(cb => {
      cb.checked = call.sintomas.includes(cb.value);
    });
    f('f_sintomaOutro').value = call.sintomaOutro;
    f('f_diagnostico').value = call.diagnostico;
    document.querySelectorAll('#testesGroup input[type=checkbox]').forEach(cb => {
      cb.checked = call.testes.includes(cb.value);
    });
    f('f_testesObs').value = call.testesObs;

    f('f_valorVisita').value = call.orcamento.valorVisita || '';
    f('f_valorMaoDeObra').value = call.orcamento.valorMaoDeObra || '';
    f('f_desconto').value = call.orcamento.desconto || '';
    f('f_situacaoOrcamento').value = call.orcamento.situacao;
    f('f_motivoRecusa').value = call.orcamento.motivoRecusa;
    toggleMotivoRecusa();

    f('f_servicoRealizado').value = call.servicoRealizado;
    pecasRows = (call.pecas || []).map(p => Object.assign({ _rid: uid() }, p));
    renderPecasTable();
    f('f_pecasNecessarias').value = call.pecasNecessarias;
    f('f_resultadoFinal').value = call.resultadoFinal || '';

    f('f_precisaRetorno').value = call.retorno.precisa;
    f('f_dataRetorno').value = call.retorno.data;
    f('f_motivoRetorno').value = call.retorno.motivo;
    f('f_obsRetorno').value = call.retorno.observacao;

    f('f_periodoGarantia').value = call.garantia.periodo;
    f('f_garantiaInicio').value = call.garantia.dataInicio;
    f('f_garantiaFim').value = call.garantia.dataFim;
    f('f_dentroGarantia').value = call.garantia.dentroGarantia;

    f('f_obsGerais').value = call.obsGerais;
    f('f_anotacoesInternas').value = call.anotacoesInternas;

    recalcOrcamento();
  }

  function toggleMarcaOutra() {
    const isOutra = document.getElementById('f_marca').value === 'Outra';
    document.getElementById('f_marcaOutraWrap').style.display = isOutra ? 'flex' : 'none';
  }

  function toggleMotivoRecusa() {
    const situacao = document.getElementById('f_situacaoOrcamento').value;
    document.getElementById('f_motivoRecusaWrap').style.display = situacao === 'Recusado' ? 'flex' : 'none';
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — PEÇAS TROCADAS
  --------------------------------------------------------------- */
  function renderPecasTable() {
    const body = document.getElementById('pecasTableBody');
    if (pecasRows.length === 0) {
      body.innerHTML = `<tr class="pecas-empty-row"><td colspan="6">Nenhuma peça adicionada.</td></tr>`;
    } else {
      body.innerHTML = pecasRows.map(row => `
        <tr data-rid="${row._rid}">
          <td><input type="text" class="pc-nome" placeholder="Nome da peça" value="${escapeHtml(row.nome || '')}"></td>
          <td><input type="number" min="1" class="pc-qtd" style="width:60px" value="${row.quantidade || 1}"></td>
          <td><input type="text" class="pc-marca" placeholder="Marca" value="${escapeHtml(row.marca || '')}"></td>
          <td><input type="text" class="pc-codigo" placeholder="Código" value="${escapeHtml(row.codigo || '')}"></td>
          <td><input type="number" min="0" step="0.01" class="pc-valor" placeholder="0,00" value="${row.valor || ''}"></td>
          <td><button type="button" class="pecas-row-remove" title="Remover"><i class="fa-solid fa-trash"></i></button></td>
        </tr>
      `).join('');
    }

    body.querySelectorAll('tr[data-rid]').forEach(tr => {
      const rid = tr.dataset.rid;
      const row = pecasRows.find(r => r._rid === rid);
      tr.querySelector('.pc-nome').addEventListener('input', e => { row.nome = e.target.value; });
      tr.querySelector('.pc-qtd').addEventListener('input', e => { row.quantidade = parseNumber(e.target.value) || 1; recalcOrcamento(); });
      tr.querySelector('.pc-marca').addEventListener('input', e => { row.marca = e.target.value; });
      tr.querySelector('.pc-codigo').addEventListener('input', e => { row.codigo = e.target.value; });
      tr.querySelector('.pc-valor').addEventListener('input', e => { row.valor = parseNumber(e.target.value); recalcOrcamento(); });
      tr.querySelector('.pecas-row-remove').addEventListener('click', () => {
        pecasRows = pecasRows.filter(r => r._rid !== rid);
        renderPecasTable();
        recalcOrcamento();
      });
    });

    const totalPecas = pecasRows.reduce((sum, r) => sum + (parseNumber(r.valor) * (parseNumber(r.quantidade) || 1)), 0);
    document.getElementById('pecasTotalDisplay').textContent = formatCurrency(totalPecas);
  }

  function addPecaRow() {
    pecasRows.push({ _rid: uid(), nome: '', quantidade: 1, marca: '', codigo: '', valor: 0 });
    renderPecasTable();
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — ORÇAMENTO (cálculo automático)
  --------------------------------------------------------------- */
  function recalcOrcamento() {
    const visita = parseNumber(document.getElementById('f_valorVisita').value);
    const maoDeObra = parseNumber(document.getElementById('f_valorMaoDeObra').value);
    const desconto = parseNumber(document.getElementById('f_desconto').value);
    const totalPecas = pecasRows.reduce((sum, r) => sum + (parseNumber(r.valor) * (parseNumber(r.quantidade) || 1)), 0);

    document.getElementById('f_valorPecas').value = totalPecas ? totalPecas.toFixed(2) : '';

    const total = Math.max(0, visita + maoDeObra + totalPecas - desconto);
    document.getElementById('f_valorTotal').textContent = formatCurrency(total);
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — GARANTIA (data final automática)
  --------------------------------------------------------------- */
  function recalcGarantiaFim() {
    const periodo = document.getElementById('f_periodoGarantia').value;
    const inicio = document.getElementById('f_garantiaInicio').value;
    const dias = { '30 dias': 30, '60 dias': 60, '90 dias': 90 }[periodo];
    if (inicio && dias) {
      const d = new Date(inicio + 'T00:00:00');
      d.setDate(d.getDate() + dias);
      const iso = d.toISOString().slice(0, 10);
      document.getElementById('f_garantiaFim').value = iso;
    }
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — HISTÓRICO DO CLIENTE
  --------------------------------------------------------------- */
  function renderHistoricoCliente(currentCall) {
    const box = document.getElementById('historicoClienteBox');
    const list = document.getElementById('historicoClienteList');
    const nome = (currentCall.cliente.nome || '').trim().toLowerCase();
    const tel = (currentCall.cliente.telefone || '').replace(/\D/g, '');

    if (!nome && !tel) { box.style.display = 'none'; return; }

    const matches = calls.filter(c => {
      if (c.id === currentCall.id) return false;
      const cNome = (c.cliente.nome || '').trim().toLowerCase();
      const cTel = (c.cliente.telefone || '').replace(/\D/g, '');
      return (nome && cNome === nome) || (tel && tel.length >= 8 && cTel === tel);
    }).sort((a, b) => (b.data || '').localeCompare(a.data || ''));

    if (matches.length === 0) { box.style.display = 'none'; return; }

    box.style.display = 'block';
    list.innerHTML = matches.map(c => {
      const marca = c.maquina.marca === 'Outra' ? c.maquina.marcaOutra : c.maquina.marca;
      const resumo = c.servicoRealizado || c.diagnostico || c.reclamacao || 'Sem detalhes registrados';
      return `<div class="history-item" data-id="${c.id}">
        <span><b>${formatDateBR(c.data)}</b> — ${escapeHtml(marca || '')} ${escapeHtml(c.maquina.modelo || '')} — ${escapeHtml(resumo.slice(0,50))}${resumo.length>50?'…':''}</span>
        <span>${escapeHtml(c.status)}</span>
      </div>`;
    }).join('');

    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        closeForm();
        openDetail(el.dataset.id);
      });
    });
  }

  // atualiza histórico ao digitar nome/telefone (com leve debounce)
  let historicoDebounce = null;
  function scheduleHistoricoUpdate() {
    clearTimeout(historicoDebounce);
    historicoDebounce = setTimeout(() => {
      const fakeCall = { id: editingId || '__new__', cliente: {
        nome: document.getElementById('f_clienteNome').value,
        telefone: document.getElementById('f_clienteTelefone').value
      } };
      renderHistoricoCliente(fakeCall);
    }, 250);
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — GOOGLE MAPS
  --------------------------------------------------------------- */
  function buildMapsUrl(cliente) {
    const parts = [cliente.endereco, cliente.numero, cliente.bairro, cliente.cidade, cliente.estado, cliente.cep].filter(Boolean);
    if (parts.length === 0) return null;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(parts.join(', '));
  }

  /* ---------------------------------------------------------------
     FORMULÁRIO — COLETAR DADOS E SALVAR
  --------------------------------------------------------------- */
  function collectFormData(baseCall) {
    const f = id => document.getElementById(id).value;
    const totalPecas = pecasRows.reduce((sum, r) => sum + (parseNumber(r.valor) * (parseNumber(r.quantidade) || 1)), 0);
    const visita = parseNumber(f('f_valorVisita'));
    const maoDeObra = parseNumber(f('f_valorMaoDeObra'));
    const desconto = parseNumber(f('f_desconto'));
    const total = Math.max(0, visita + maoDeObra + totalPecas - desconto);

    const sintomas = Array.from(document.querySelectorAll('#sintomasGroup input:checked')).map(cb => cb.value);
    const testes = Array.from(document.querySelectorAll('#testesGroup input:checked')).map(cb => cb.value);

    const call = Object.assign({}, baseCall, {
      numero: f('f_numero'),
      data: f('f_data'),
      horario: f('f_horario'),
      tipoAtendimento: f('f_tipoAtendimento'),
      status: f('f_status'),

      cliente: {
        nome: f('f_clienteNome').trim(),
        telefone: f('f_clienteTelefone').trim(),
        endereco: f('f_endereco').trim(),
        numero: f('f_enderecoNumero').trim(),
        complemento: f('f_complemento').trim(),
        bairro: f('f_bairro').trim(),
        cidade: f('f_cidade').trim(),
        estado: f('f_estado').trim().toUpperCase(),
        cep: f('f_cep').trim()
      },

      maquina: {
        marca: f('f_marca'),
        marcaOutra: f('f_marcaOutra').trim(),
        modelo: f('f_modelo').trim(),
        tipo: f('f_tipoMaquina'),
        capacidade: f('f_capacidade'),
        voltagem: f('f_voltagem'),
        numeroSerie: f('f_numeroSerie').trim(),
        tempoUso: f('f_tempoUso').trim()
      },

      reclamacao: f('f_reclamacao').trim(),
      sintomas,
      sintomaOutro: f('f_sintomaOutro').trim(),
      diagnostico: f('f_diagnostico').trim(),
      testes,
      testesObs: f('f_testesObs').trim(),

      orcamento: {
        valorVisita: visita, valorMaoDeObra: maoDeObra, valorPecas: totalPecas,
        desconto, valorTotal: total,
        situacao: f('f_situacaoOrcamento'),
        motivoRecusa: f('f_motivoRecusa')
      },

      servicoRealizado: f('f_servicoRealizado').trim(),
      pecas: pecasRows.filter(r => r.nome && r.nome.trim()).map(r => ({
        nome: r.nome.trim(), quantidade: parseNumber(r.quantidade) || 1,
        marca: (r.marca || '').trim(), codigo: (r.codigo || '').trim(), valor: parseNumber(r.valor)
      })),
      pecasNecessarias: f('f_pecasNecessarias').trim(),
      resultadoFinal: f('f_resultadoFinal'),

      retorno: {
        precisa: f('f_precisaRetorno'),
        data: f('f_dataRetorno'),
        motivo: f('f_motivoRetorno'),
        observacao: f('f_obsRetorno').trim()
      },

      garantia: {
        periodo: f('f_periodoGarantia'),
        dataInicio: f('f_garantiaInicio'),
        dataFim: f('f_garantiaFim'),
        dentroGarantia: f('f_dentroGarantia')
      },

      obsGerais: f('f_obsGerais').trim(),
      anotacoesInternas: f('f_anotacoesInternas').trim(),

      atualizadoEm: new Date().toISOString()
    });

    return call;
  }

  function validateForm() {
    const errors = [];
    if (!document.getElementById('f_data').value) errors.push('Informe a data do atendimento.');
    if (!document.getElementById('f_clienteNome').value.trim()) errors.push('Informe o nome do cliente.');
    return errors;
  }

  function saveForm() {
    const errors = validateForm();
    if (errors.length) {
      showToast(errors[0], true);
      // leva o usuário para a aba correta
      if (errors[0].includes('data')) goToTab('tab-atendimento');
      else if (errors[0].includes('cliente')) goToTab('tab-cliente');
      return;
    }

    const base = editingId ? calls.find(c => c.id === editingId) : blankCall();
    const updated = collectFormData(base);

    if (editingId) {
      const idx = calls.findIndex(c => c.id === editingId);
      calls[idx] = updated;
    } else {
      calls.push(updated);
    }

    if (!saveData()) return;
    showToast(editingId ? 'Chamada atualizada com sucesso.' : `Chamada ${updated.numero} cadastrada com sucesso.`);
    closeForm();
    populateMarcaFilter();
    refreshDashboard();

    if (sb) {
      cloudUpsert(updated).then(ok => {
        setSyncStatus(ok ? 'synced' : 'offline');
        if (!ok) showToast('Salvo neste aparelho. Sem conexão para sincronizar agora.', true);
      });
    }
  }

  /* ---------------------------------------------------------------
     EXCLUIR CHAMADA
  --------------------------------------------------------------- */
  function deleteCall(id) {
    const call = calls.find(c => c.id === id);
    if (!call) return;
    openConfirm({
      title: 'Excluir chamada?',
      message: `A chamada ${call.numero} (${call.cliente.nome || 'sem nome'}) será excluída permanentemente. Esta ação não pode ser desfeita.`,
      okLabel: 'Excluir',
      danger: true,
      onConfirm: () => {
        calls = calls.filter(c => c.id !== id);
        saveData();
        closeDetail();
        populateMarcaFilter();
        refreshDashboard();
        showToast('Chamada excluída.');
        if (sb) cloudDelete(id).then(ok => setSyncStatus(ok ? 'synced' : 'offline'));
      }
    });
  }

  /* ---------------------------------------------------------------
     TELA DE DETALHE (VISUALIZAR)
  --------------------------------------------------------------- */
  function openDetail(id) {
    const call = calls.find(c => c.id === id);
    if (!call) { showToast('Chamada não encontrada.', true); return; }
    detailCallId = id;
    document.getElementById('detailNumero').textContent = call.numero;
    document.getElementById('detailTitle').textContent = call.cliente.nome || 'Chamada sem nome';
    document.getElementById('detailBody').innerHTML = renderDetailHtml(call);

    document.getElementById('detailModalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';

    const mapsLink = document.getElementById('btnMapsDetail');
    if (mapsLink) {
      const url = buildMapsUrl(call.cliente);
      mapsLink.addEventListener('click', () => {
        if (url) window.open(url, '_blank');
        else showToast('Endereço incompleto para abrir no Maps.', true);
      });
    }
  }

  function closeDetail() {
    document.getElementById('detailModalOverlay').classList.remove('open');
    document.body.style.overflow = '';
    detailCallId = null;
  }

  function chipList(items) {
    if (!items || items.length === 0) return '<span class="detail-empty">Nenhum registrado.</span>';
    return `<div class="detail-chips">${items.map(i => `<span class="detail-chip">${escapeHtml(i)}</span>`).join('')}</div>`;
  }

  function textOrEmpty(t) {
    return t && t.trim() ? `<div class="detail-text">${escapeHtml(t)}</div>` : '<span class="detail-empty">Não registrado.</span>';
  }

  function renderDetailHtml(c) {
    const marca = c.maquina.marca === 'Outra' ? (c.maquina.marcaOutra || 'Outra') : c.maquina.marca;
    const enderecoCompleto = [c.cliente.endereco, c.cliente.numero].filter(Boolean).join(', ');
    const mapsUrl = buildMapsUrl(c.cliente);

    const pecasHtml = (c.pecas && c.pecas.length) ? `
      <table class="detail-pecas-table">
        <thead><tr><th>Peça</th><th>Qtd.</th><th>Marca</th><th>Código</th><th>Valor</th></tr></thead>
        <tbody>
          ${c.pecas.map(p => `<tr><td>${escapeHtml(p.nome)}</td><td>${p.quantidade}</td><td>${escapeHtml(p.marca||'—')}</td><td>${escapeHtml(p.codigo||'—')}</td><td>${formatCurrency(p.valor)}</td></tr>`).join('')}
        </tbody>
      </table>` : '<span class="detail-empty">Nenhuma peça trocada registrada.</span>';

    return `
      <div class="detail-card">
        <h4><i class="fa-solid fa-calendar-check"></i> Atendimento</h4>
        <div class="detail-grid">
          <div class="detail-item"><span>Data</span><b>${formatDateBR(c.data)}</b></div>
          <div class="detail-item"><span>Horário</span><b>${c.horario || '—'}</b></div>
          <div class="detail-item"><span>Tipo</span><b>${escapeHtml(c.tipoAtendimento)}</b></div>
          <div class="detail-item"><span>Status</span><b><span class="status-badge status-${slugStatus(c.status)}">${escapeHtml(c.status)}</span></b></div>
        </div>
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-user"></i> Cliente</h4>
        <div class="detail-grid">
          <div class="detail-item"><span>Nome</span><b>${escapeHtml(c.cliente.nome || '—')}</b></div>
          <div class="detail-item"><span>Telefone</span><b>${escapeHtml(c.cliente.telefone || '—')}</b></div>
        </div>
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-location-dot"></i> Endereço</h4>
        <div class="detail-grid">
          <div class="detail-item"><span>Endereço</span><b>${escapeHtml(enderecoCompleto || '—')}</b></div>
          <div class="detail-item"><span>Complemento</span><b>${escapeHtml(c.cliente.complemento || '—')}</b></div>
          <div class="detail-item"><span>Bairro</span><b>${escapeHtml(c.cliente.bairro || '—')}</b></div>
          <div class="detail-item"><span>Cidade/UF</span><b>${escapeHtml([c.cliente.cidade, c.cliente.estado].filter(Boolean).join(' / ') || '—')}</b></div>
          <div class="detail-item"><span>CEP</span><b>${escapeHtml(c.cliente.cep || '—')}</b></div>
        </div>
        <button type="button" class="btn btn-outline" id="btnMapsDetail" style="margin-top:12px;" ${mapsUrl ? '' : 'disabled'}><i class="fa-solid fa-location-dot"></i> Abrir no Google Maps</button>
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-washing-machine"></i> Máquina</h4>
        <div class="detail-grid">
          <div class="detail-item"><span>Marca</span><b>${escapeHtml(marca)}</b></div>
          <div class="detail-item"><span>Modelo</span><b>${escapeHtml(c.maquina.modelo || '—')}</b></div>
          <div class="detail-item"><span>Tipo</span><b>${escapeHtml(c.maquina.tipo)}</b></div>
          <div class="detail-item"><span>Capacidade</span><b>${escapeHtml(c.maquina.capacidade || '—')}</b></div>
          <div class="detail-item"><span>Voltagem</span><b>${escapeHtml(c.maquina.voltagem)}</b></div>
          <div class="detail-item"><span>Nº de série</span><b>${escapeHtml(c.maquina.numeroSerie || '—')}</b></div>
          <div class="detail-item"><span>Tempo de uso</span><b>${escapeHtml(c.maquina.tempoUso || '—')}</b></div>
        </div>
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-quote-left"></i> Reclamação do cliente</h4>
        ${textOrEmpty(c.reclamacao)}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-list-check"></i> Sintomas</h4>
        ${chipList(c.sintomas)}
        ${c.sintomaOutro ? `<div class="detail-text" style="margin-top:8px;">${escapeHtml(c.sintomaOutro)}</div>` : ''}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-stethoscope"></i> Diagnóstico</h4>
        ${textOrEmpty(c.diagnostico)}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-vial"></i> Testes realizados</h4>
        ${chipList(c.testes)}
        ${c.testesObs ? `<div class="detail-text" style="margin-top:8px;">${escapeHtml(c.testesObs)}</div>` : ''}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-screwdriver-wrench"></i> Serviço executado</h4>
        ${textOrEmpty(c.servicoRealizado)}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-gears"></i> Peças</h4>
        ${pecasHtml}
        ${c.pecasNecessarias ? `<div class="detail-item" style="margin-top:12px;"><span>Peças necessárias / aguardando</span><div class="detail-text">${escapeHtml(c.pecasNecessarias)}</div></div>` : ''}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-file-invoice-dollar"></i> Orçamento</h4>
        <div class="detail-grid">
          <div class="detail-item"><span>Visita</span><b>${formatCurrency(c.orcamento.valorVisita)}</b></div>
          <div class="detail-item"><span>Mão de obra</span><b>${formatCurrency(c.orcamento.valorMaoDeObra)}</b></div>
          <div class="detail-item"><span>Peças</span><b>${formatCurrency(c.orcamento.valorPecas)}</b></div>
          <div class="detail-item"><span>Desconto</span><b>${formatCurrency(c.orcamento.desconto)}</b></div>
          <div class="detail-item"><span>Total</span><b style="color:var(--accent)">${formatCurrency(c.orcamento.valorTotal)}</b></div>
          <div class="detail-item"><span>Situação</span><b>${escapeHtml(c.orcamento.situacao)}</b></div>
          ${c.orcamento.motivoRecusa ? `<div class="detail-item"><span>Motivo da recusa</span><b>${escapeHtml(c.orcamento.motivoRecusa)}</b></div>` : ''}
        </div>
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-flag-checkered"></i> Resultado do atendimento</h4>
        ${c.resultadoFinal ? `<span class="status-badge status-${slugStatus(c.resultadoFinal)}">${escapeHtml(c.resultadoFinal)}</span>` : '<span class="detail-empty">Não informado.</span>'}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-rotate-left"></i> Retorno</h4>
        <div class="detail-grid">
          <div class="detail-item"><span>Precisa de retorno?</span><b>${escapeHtml(c.retorno.precisa)}</b></div>
          <div class="detail-item"><span>Data prevista</span><b>${c.retorno.data ? formatDateBR(c.retorno.data) : '—'}</b></div>
          <div class="detail-item"><span>Motivo</span><b>${escapeHtml(c.retorno.motivo || '—')}</b></div>
        </div>
        ${c.retorno.observacao ? `<div class="detail-text" style="margin-top:10px;">${escapeHtml(c.retorno.observacao)}</div>` : ''}
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-shield-halved"></i> Garantia</h4>
        <div class="detail-grid">
          <div class="detail-item"><span>Período</span><b>${escapeHtml(c.garantia.periodo)}</b></div>
          <div class="detail-item"><span>Início</span><b>${c.garantia.dataInicio ? formatDateBR(c.garantia.dataInicio) : '—'}</b></div>
          <div class="detail-item"><span>Fim</span><b>${c.garantia.dataFim ? formatDateBR(c.garantia.dataFim) : '—'}</b></div>
          <div class="detail-item"><span>Dentro da garantia?</span><b>${escapeHtml(c.garantia.dentroGarantia)}</b></div>
        </div>
      </div>

      <div class="detail-card">
        <h4><i class="fa-solid fa-note-sticky"></i> Observações gerais</h4>
        ${textOrEmpty(c.obsGerais)}
      </div>

      <div class="detail-card private">
        <h4><i class="fa-solid fa-lock"></i> Anotações internas (privado)</h4>
        ${textOrEmpty(c.anotacoesInternas)}
      </div>
    `;
  }

  /* ---------------------------------------------------------------
     DIALOG DE CONFIRMAÇÃO GENÉRICO
  --------------------------------------------------------------- */
  function openConfirm({ title, message, okLabel, danger, requireText, onConfirm }) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const okBtn = document.getElementById('confirmOkBtn');
    okBtn.textContent = okLabel || 'Confirmar';
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');

    const inputWrap = document.getElementById('confirmInputWrap');
    const input = document.getElementById('confirmInput');
    if (requireText) {
      inputWrap.style.display = 'block';
      input.value = '';
      input.placeholder = `Digite ${requireText} para confirmar`;
      okBtn.disabled = true;
    } else {
      inputWrap.style.display = 'none';
      okBtn.disabled = false;
    }

    confirmCallback = () => {
      if (requireText && input.value.trim().toUpperCase() !== requireText.toUpperCase()) {
        showToast('Texto de confirmação incorreto.', true);
        return;
      }
      onConfirm();
      closeConfirm();
    };

    if (requireText) {
      input.oninput = () => { okBtn.disabled = input.value.trim().toUpperCase() !== requireText.toUpperCase(); };
    }

    document.getElementById('confirmOverlay').classList.add('open');
  }

  function closeConfirm() {
    document.getElementById('confirmOverlay').classList.remove('open');
    confirmCallback = null;
  }

  /* ---------------------------------------------------------------
     BACKUP — EXPORTAR / IMPORTAR / APAGAR TUDO
  --------------------------------------------------------------- */
  function exportBackup() {
    const payload = {
      app: 'SID Consertos - Controle de Chamadas',
      exportadoEm: new Date().toISOString(),
      versao: 1,
      chamadas: calls
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dataStr = todayISO();
    a.href = url;
    a.download = `sid-consertos-backup-${dataStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup exportado com sucesso.');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const incoming = Array.isArray(data) ? data : data.chamadas;
        if (!Array.isArray(incoming)) throw new Error('Formato inválido');

        openConfirm({
          title: 'Importar backup?',
          message: `Foram encontradas ${incoming.length} chamada(s) no arquivo. Elas serão adicionadas às chamadas já existentes (${calls.length}). Chamadas com o mesmo número serão substituídas.`,
          okLabel: 'Importar',
          onConfirm: () => {
            const byNumero = new Map(calls.map(c => [c.numero, c]));
            incoming.forEach(c => {
              if (!c.id) c.id = uid();
              byNumero.set(c.numero, c);
            });
            calls = Array.from(byNumero.values());
            saveData();
            populateMarcaFilter();
            refreshDashboard();
            showToast('Backup importado com sucesso.');
            if (sb) {
              setSyncStatus('syncing');
              Promise.all(incoming.map(c => cloudUpsert(c))).then(results => {
                setSyncStatus(results.every(Boolean) ? 'synced' : 'error');
              });
            }
          }
        });
      } catch (err) {
        console.error(err);
        showToast('Arquivo de backup inválido.', true);
      }
    };
    reader.readAsText(file);
  }

  function wipeAllData() {
    openConfirm({
      title: 'Apagar todos os dados?',
      message: 'Todas as chamadas cadastradas serão apagadas permanentemente deste navegador. Esta ação não pode ser desfeita. Exporte um backup antes, se necessário.',
      okLabel: 'Apagar tudo',
      danger: true,
      requireText: 'APAGAR',
      onConfirm: () => {
        calls = [];
        saveData();
        populateMarcaFilter();
        refreshDashboard();
        showToast('Todos os dados foram apagados.');
        if (sb) cloudWipe().then(ok => setSyncStatus(ok ? 'synced' : 'error'));
      }
    });
  }

  /* ---------------------------------------------------------------
     TEMA (claro / escuro)
  --------------------------------------------------------------- */
  function applyTheme(isDark) {
    document.body.classList.toggle('theme-light', !isDark);
    localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    document.getElementById('themeToggle').checked = isDark;
  }

  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved !== 'light');
  }

  /* ---------------------------------------------------------------
     EVENTOS — INICIALIZAÇÃO
  --------------------------------------------------------------- */
  function bindEvents() {
    // topo
    document.getElementById('btnNewCall').addEventListener('click', () => openForm(null));
    document.getElementById('btnSettings').addEventListener('click', () => {
      document.getElementById('settingsModalOverlay').classList.add('open');
    });
    document.getElementById('btnCloseSettings').addEventListener('click', () => {
      document.getElementById('settingsModalOverlay').classList.remove('open');
    });

    // pesquisa e filtros
    document.getElementById('searchInput').addEventListener('input', renderList);
    document.getElementById('filterStatus').addEventListener('change', renderList);
    document.getElementById('filterMarca').addEventListener('change', renderList);
    document.getElementById('filterPeriodo').addEventListener('change', () => {
      document.getElementById('filterCustomDates').style.display =
        document.getElementById('filterPeriodo').value === 'personalizado' ? 'flex' : 'none';
      renderList();
    });
    document.getElementById('filterDateFrom').addEventListener('change', renderList);
    document.getElementById('filterDateTo').addEventListener('change', renderList);
    document.getElementById('btnToggleFilters').addEventListener('click', () => {
      document.getElementById('filtersBar').classList.toggle('open');
    });
    document.getElementById('btnClearFilters').addEventListener('click', () => {
      document.getElementById('filterStatus').value = '';
      document.getElementById('filterMarca').value = '';
      document.getElementById('filterPeriodo').value = '';
      document.getElementById('filterDateFrom').value = '';
      document.getElementById('filterDateTo').value = '';
      document.getElementById('filterCustomDates').style.display = 'none';
      document.getElementById('searchInput').value = '';
      renderList();
    });

    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentListView = btn.dataset.view;
        document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
        renderList();
      });
    });

    // formulário — abas
    document.querySelectorAll('.form-tab').forEach(btn => {
      btn.addEventListener('click', () => goToTab(btn.dataset.tab));
    });
    document.getElementById('btnPrevTab').addEventListener('click', () => {
      const active = document.querySelector('.form-tab-panel.active').id;
      const idx = TAB_ORDER.indexOf(active);
      if (idx > 0) goToTab(TAB_ORDER[idx - 1]);
    });
    document.getElementById('btnNextTab').addEventListener('click', () => {
      const active = document.querySelector('.form-tab-panel.active').id;
      const idx = TAB_ORDER.indexOf(active);
      if (idx < TAB_ORDER.length - 1) goToTab(TAB_ORDER[idx + 1]);
    });

    // formulário — fechar / salvar
    document.getElementById('btnCloseForm').addEventListener('click', closeForm);
    document.getElementById('btnCancelForm').addEventListener('click', closeForm);
    document.getElementById('btnSaveForm').addEventListener('click', saveForm);
    document.getElementById('callForm').addEventListener('submit', e => e.preventDefault());

    // formulário — dependências dinâmicas
    document.getElementById('f_marca').addEventListener('change', toggleMarcaOutra);
    document.getElementById('f_situacaoOrcamento').addEventListener('change', toggleMotivoRecusa);
    ['f_valorVisita','f_valorMaoDeObra','f_desconto'].forEach(id => {
      document.getElementById(id).addEventListener('input', recalcOrcamento);
    });
    document.getElementById('f_periodoGarantia').addEventListener('change', recalcGarantiaFim);
    document.getElementById('f_garantiaInicio').addEventListener('change', recalcGarantiaFim);
    document.getElementById('f_clienteNome').addEventListener('input', scheduleHistoricoUpdate);
    document.getElementById('f_clienteTelefone').addEventListener('input', scheduleHistoricoUpdate);

    document.getElementById('btnAddPeca').addEventListener('click', addPecaRow);

    document.getElementById('btnMapsForm').addEventListener('click', () => {
      const cliente = {
        endereco: document.getElementById('f_endereco').value,
        numero: document.getElementById('f_enderecoNumero').value,
        bairro: document.getElementById('f_bairro').value,
        cidade: document.getElementById('f_cidade').value,
        estado: document.getElementById('f_estado').value,
        cep: document.getElementById('f_cep').value
      };
      const url = buildMapsUrl(cliente);
      if (url) window.open(url, '_blank');
      else showToast('Preencha ao menos o endereço para abrir no Maps.', true);
    });

    // detalhe
    document.getElementById('btnCloseDetail').addEventListener('click', closeDetail);
    document.getElementById('btnEditFromDetail').addEventListener('click', () => {
      const id = detailCallId;
      closeDetail();
      openForm(id);
    });
    document.getElementById('btnDeleteFromDetail').addEventListener('click', () => {
      if (detailCallId) deleteCall(detailCallId);
    });

    // configurações
    document.getElementById('themeToggle').addEventListener('change', e => applyTheme(e.target.checked));
    document.getElementById('btnExportBackup').addEventListener('click', exportBackup);
    document.getElementById('importFileInput').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) importBackup(file);
      e.target.value = '';
    });
    document.getElementById('btnWipeData').addEventListener('click', wipeAllData);

    // confirm dialog
    document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirm);
    document.getElementById('confirmOkBtn').addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
    });

    // fechar modais clicando fora
    [['formModalOverlay', closeForm], ['detailModalOverlay', closeDetail],
     ['settingsModalOverlay', () => document.getElementById('settingsModalOverlay').classList.remove('open')],
     ['confirmOverlay', closeConfirm]].forEach(([id, closer]) => {
      document.getElementById(id).addEventListener('click', e => {
        if (e.target.id === id) closer();
      });
    });

    // ESC fecha modal ativo
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (document.getElementById('confirmOverlay').classList.contains('open')) closeConfirm();
      else if (document.getElementById('formModalOverlay').classList.contains('open')) closeForm();
      else if (document.getElementById('detailModalOverlay').classList.contains('open')) closeDetail();
      else if (document.getElementById('settingsModalOverlay').classList.contains('open')) document.getElementById('settingsModalOverlay').classList.remove('open');
    });
  }

  /* ---------------------------------------------------------------
     SINCRONIZAÇÃO EM NUVEM (SUPABASE)
     -------------------------------------------------------------
     O app funciona 100% offline salvando no localStorage (cache
     local). Se config.js tiver uma URL/chave válidas do Supabase,
     o app também envia e busca as chamadas na nuvem, permitindo
     usar o mesmo controle em vários aparelhos.
     Estratégia: local-first (a tela nunca fica esperando a rede),
     com sincronização em segundo plano e "quem atualizou por
     último, vence" (comparando atualizadoEm) na hora de mesclar.
  --------------------------------------------------------------- */
  function isCloudConfigured() {
    return !!(window.SUPABASE_CONFIG &&
      window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey &&
      window.SUPABASE_CONFIG.url.indexOf('SEU-PROJETO') === -1 &&
      window.SUPABASE_CONFIG.anonKey.indexOf('SUA-CHAVE') === -1);
  }

  function initSupabase() {
    if (!isCloudConfigured() || !window.supabase || !window.supabase.createClient) {
      sb = null;
      return;
    }
    try {
      sb = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    } catch (e) {
      console.error('Erro ao iniciar Supabase', e);
      sb = null;
    }
  }

  function setSyncStatus(state) {
    const badge = document.getElementById('syncStatus');
    const text = document.getElementById('syncStatusText');
    if (!badge) return;
    const labels = {
      'local-only': 'Somente local',
      'offline': 'Sem conexão',
      'syncing': 'Sincronizando…',
      'synced': 'Sincronizado',
      'error': 'Erro ao sincronizar'
    };
    const icons = {
      'local-only': 'fa-hard-drive',
      'offline': 'fa-cloud-arrow-up',
      'syncing': 'fa-rotate fa-spin',
      'synced': 'fa-cloud',
      'error': 'fa-triangle-exclamation'
    };
    badge.className = 'sync-status sync-' + state;
    badge.querySelector('i').className = 'fa-solid ' + (icons[state] || 'fa-cloud');
    text.textContent = labels[state] || '';
    updateCloudSettingsHint(state);
  }

  function updateCloudSettingsHint(state) {
    const hint = document.getElementById('cloudStatusHint');
    if (!hint) return;
    if (!isCloudConfigured()) {
      hint.textContent = 'Não configurado — os dados ficam salvos apenas neste navegador. Preencha o arquivo config.js para sincronizar entre aparelhos (veja instruções dentro do arquivo).';
      return;
    }
    const messages = {
      'syncing': 'Sincronizando com a nuvem...',
      'synced': 'Conectado e sincronizado com a nuvem. Suas chamadas aparecem em qualquer aparelho configurado com o mesmo projeto.',
      'offline': 'Configurado, mas sem conexão no momento. As alterações estão salvas neste aparelho e serão enviadas quando a internet voltar.',
      'error': 'Configurado, mas houve um erro ao sincronizar. Verifique a URL, a chave e se o script SUPABASE-SETUP.sql foi executado.',
      'local-only': 'Configurado. Sincronizando...'
    };
    hint.textContent = messages[state] || '';
  }

  async function cloudFetchAll() {
    if (!sb) return null;
    try {
      const { data, error } = await sb.from(CLOUD_TABLE).select('payload');
      if (error) throw error;
      return data.map(row => row.payload);
    } catch (e) {
      console.error('cloudFetchAll', e);
      return null;
    }
  }

  async function cloudUpsert(call) {
    if (!sb) return false;
    try {
      const { error } = await sb.from(CLOUD_TABLE).upsert({
        id: call.id,
        numero: call.numero,
        atualizado_em: call.atualizadoEm || new Date().toISOString(),
        payload: call
      }, { onConflict: 'id' });
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('cloudUpsert', e);
      return false;
    }
  }

  async function cloudDelete(id) {
    if (!sb) return false;
    try {
      const { error } = await sb.from(CLOUD_TABLE).delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('cloudDelete', e);
      return false;
    }
  }

  async function cloudWipe() {
    if (!sb) return false;
    try {
      const { error } = await sb.from(CLOUD_TABLE).delete().neq('id', '__nunca__');
      if (error) throw error;
      return true;
    } catch (e) {
      console.error('cloudWipe', e);
      return false;
    }
  }

  // Busca a nuvem, mescla com o que está local (o mais recente vence)
  // e envia de volta qualquer coisa que só exista localmente.
  async function syncFromCloud(silent) {
    if (!sb) { setSyncStatus('local-only'); return; }
    if (!navigator.onLine) { setSyncStatus('offline'); return; }

    setSyncStatus('syncing');
    const cloudCalls = await cloudFetchAll();
    if (cloudCalls === null) { setSyncStatus('offline'); return; }

    const merged = new Map(calls.map(c => [c.id, c]));
    const toPush = [];

    cloudCalls.forEach(cc => {
      const local = merged.get(cc.id);
      if (!local) {
        merged.set(cc.id, cc);
      } else {
        const cloudNewer = new Date(cc.atualizadoEm || 0) >= new Date(local.atualizadoEm || 0);
        if (cloudNewer) merged.set(cc.id, cc);
        else toPush.push(local);
      }
    });

    // chamadas que existem só localmente (nunca chegaram na nuvem)
    calls.forEach(c => {
      if (!cloudCalls.find(cc => cc.id === c.id)) toPush.push(c);
    });

    calls = Array.from(merged.values());
    saveData();

    for (const c of toPush) {
      await cloudUpsert(c);
    }

    populateMarcaFilter();
    refreshDashboard();
    setSyncStatus('synced');
    if (!silent) showToast('Sincronizado com a nuvem.');
  }

  /* ---------------------------------------------------------------
     INICIALIZAÇÃO
  --------------------------------------------------------------- */
  function init() {
    loadTheme();
    loadData();              // cache local — a tela abre instantaneamente
    populateMarcaFilter();
    bindEvents();
    refreshDashboard();

    initSupabase();
    setSyncStatus(sb ? 'syncing' : 'local-only');
    if (sb) syncFromCloud(true);

    window.addEventListener('online', () => { if (sb) syncFromCloud(true); });
    window.addEventListener('offline', () => setSyncStatus('offline'));

    const forceSyncBtn = document.getElementById('btnForceSync');
    if (forceSyncBtn) forceSyncBtn.addEventListener('click', () => syncFromCloud(false));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
