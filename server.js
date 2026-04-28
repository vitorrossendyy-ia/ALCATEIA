const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(cors());

// ─── Mercado Pago ───
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || "TEST-1411058631952367-042813-2293bc803e953dc2aff159288614561d-256824285",
});
const payment = new Payment(client);

// ─── Senhas ───
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "082751@Oreo";
const AUTH_PASS  = process.env.AUTH_PASSWORD  || "Oreo@autorizar2024";

// ─── Banco de dados ───
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
console.log("DATABASE_URL presente:", !!DB_URL);

const pool = DB_URL ? new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
}) : null;

// Fallback em memória caso banco não conecte
const memoria = [];

async function salvar(dados) {
  if (pool) {
    await pool.query(
      `INSERT INTO cadastros (id, nome, email, whatsapp, status, valor, tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [dados.id, dados.nome, dados.email, dados.whatsapp, dados.status, dados.valor, dados.tipo]
    );
  } else {
    memoria.unshift(dados);
  }
}

async function buscarTodos() {
  if (pool) {
    const r = await pool.query("SELECT * FROM cadastros ORDER BY criado_em DESC");
    return r.rows;
  }
  return memoria;
}

async function atualizarStatus(id, status) {
  if (pool) {
    await pool.query("UPDATE cadastros SET status=$1 WHERE id=$2", [status, id]);
  } else {
    const p = memoria.find(p => p.id === id);
    if (p) p.status = status;
  }
}

async function buscarStatus(id) {
  if (pool) {
    const r = await pool.query("SELECT status FROM cadastros WHERE id=$1", [id]);
    return r.rows[0]?.status;
  }
  return memoria.find(p => p.id === id)?.status;
}

async function apagar(id) {
  if (pool) {
    await pool.query("DELETE FROM cadastros WHERE id=$1", [id]);
  } else {
    const i = memoria.findIndex(p => p.id === id);
    if (i > -1) memoria.splice(i, 1);
  }
}

// Cria tabela
if (pool) {
  pool.query(`CREATE TABLE IF NOT EXISTS cadastros (
    id TEXT PRIMARY KEY, nome TEXT, email TEXT, whatsapp TEXT,
    status TEXT DEFAULT 'pending', valor INTEGER DEFAULT 99,
    tipo TEXT DEFAULT 'pix', criado_em TIMESTAMPTZ DEFAULT NOW()
  )`).then(() => console.log("✅ Banco pronto")).catch(e => console.error("Erro banco:", e.message));
}

// ─── Middleware admin ───
function adminAuth(req, res, next) {
  if (req.headers["x-admin-password"] !== ADMIN_PASS) return res.status(401).json({ error: "Não autorizado" });
  next();
}

// ─── Criar Pix ───
app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, email, whatsapp } = req.body;
    const result = await payment.create({
      body: {
        transaction_amount: 99,
        description: "Alcateia — Grupo Exclusivo de Fornecedores",
        payment_method_id: "pix",
        payer: { email: email || "comprador@email.com", first_name: nome || "Comprador" },
      },
    });
    const pixData = result.point_of_interaction?.transaction_data;
    await salvar({ id: String(result.id), nome: nome||"—", email: email||"—", whatsapp: whatsapp||"—", status: result.status, valor: 99, tipo: "pix" });
    res.json({ id: result.id, status: result.status, qr_code: pixData?.qr_code, qr_code_base64: pixData?.qr_code_base64 });
  } catch (err) {
    console.error("Erro Pix:", err.message);
    res.status(500).json({ error: "Erro ao gerar Pix. Tente novamente." });
  }
});

// ─── Verificar pagamento ───
app.get("/verificar/:id", async (req, res) => {
  try {
    const statusLocal = await buscarStatus(req.params.id);
    if (statusLocal === "approved") return res.json({ status: "approved" });
    const result = await payment.get({ id: req.params.id });
    await atualizarStatus(req.params.id, result.status);
    res.json({ status: result.status });
  } catch (err) {
    const statusLocal = await buscarStatus(req.params.id).catch(() => null);
    if (statusLocal) return res.json({ status: statusLocal });
    res.status(500).json({ error: "Erro ao verificar." });
  }
});

// ─── Admin: listar ───
app.get("/admin/pagamentos", adminAuth, async (req, res) => {
  try {
    const todos = await buscarTodos();
    const aprovados = todos.filter(p => p.status === "approved").length;
    const receita = todos.filter(p => p.status === "approved").reduce((a, p) => a + (parseInt(p.valor)||0), 0);
    res.json({ pagamentos: todos, total: todos.length, aprovados, receita });
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar." });
  }
});

// ─── Admin: autorizar ───
app.post("/admin/autorizar/:id", adminAuth, async (req, res) => {
  await atualizarStatus(req.params.id, "approved");
  res.json({ ok: true });
});

// ─── Admin: apagar ───
app.delete("/admin/apagar/:id", adminAuth, async (req, res) => {
  if (req.body.senha !== AUTH_PASS) return res.status(401).json({ error: "Senha incorreta" });
  await apagar(req.params.id);
  res.json({ ok: true });
});

// ─── Liberar acesso gratuito ───
app.post("/autorizar-acesso", async (req, res) => {
  const { senha, nome, email, whatsapp } = req.body;
  if (senha !== AUTH_PASS) return res.status(401).json({ error: "Senha incorreta" });
  await salvar({ id: "GRATUITO-"+Date.now(), nome: nome||"Acesso Gratuito", email: email||"—", whatsapp: whatsapp||"—", status: "approved", valor: 0, tipo: "gratuito" });
  res.json({ ok: true });
});

// ─── Admin: simular ───
app.post("/admin/simular", adminAuth, async (req, res) => {
  await salvar({ id: "SIMULADO-"+Date.now(), nome: req.body.nome||"Cliente Teste", email: req.body.email||"teste@alcateia.com", whatsapp: "—", status: "pending", valor: 99, tipo: "pix" });
  res.json({ ok: true });
});

// ─── Admin: login ───
app.post("/admin/login", (req, res) => {
  if (req.body.senha === ADMIN_PASS) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static("public"));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Alcateia rodando na porta ${PORT}`));
