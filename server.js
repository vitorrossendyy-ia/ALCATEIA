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
let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log("🔗 Conectando ao PostgreSQL via DATABASE_URL...");
} else {
  console.error("❌ DATABASE_URL não definida!");
  process.exit(1);
}

// Cria tabela se não existir
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cadastros (
      id TEXT PRIMARY KEY,
      nome TEXT,
      email TEXT,
      whatsapp TEXT,
      status TEXT DEFAULT 'pending',
      valor INTEGER DEFAULT 99,
      tipo TEXT DEFAULT 'pix',
      criado_em TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ Banco de dados pronto");
}
initDB().catch(e => console.error("Erro initDB:", e.message));

// ─── Middleware admin ───
function adminAuth(req, res, next) {
  const senha = req.headers["x-admin-password"];
  if (senha !== ADMIN_PASS) return res.status(401).json({ error: "Não autorizado" });
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
        payer: {
          email: email || "comprador@email.com",
          first_name: nome || "Comprador",
        },
      },
    });

    const pixData = result.point_of_interaction?.transaction_data;

    // Salva no banco
    await pool.query(
      `INSERT INTO cadastros (id, nome, email, whatsapp, status, valor, tipo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [String(result.id), nome || "—", email || "—", whatsapp || "—", result.status, 99, "pix"]
    );

    res.json({
      id: result.id,
      status: result.status,
      qr_code: pixData?.qr_code,
      qr_code_base64: pixData?.qr_code_base64,
    });
  } catch (err) {
    console.error("Erro ao criar Pix:", err);
    res.status(500).json({ error: "Erro ao gerar Pix. Tente novamente." });
  }
});

// ─── Verificar pagamento ───
app.get("/verificar/:id", async (req, res) => {
  try {
    const local = await pool.query("SELECT status FROM cadastros WHERE id=$1", [req.params.id]);
    if (local.rows[0]?.status === "approved") return res.json({ status: "approved" });

    const result = await payment.get({ id: req.params.id });
    await pool.query("UPDATE cadastros SET status=$1 WHERE id=$2", [result.status, String(req.params.id)]);
    res.json({ status: result.status });
  } catch (err) {
    const local = await pool.query("SELECT status FROM cadastros WHERE id=$1", [req.params.id]).catch(() => ({ rows: [] }));
    if (local.rows[0]) return res.json({ status: local.rows[0].status });
    res.status(500).json({ error: "Erro ao verificar." });
  }
});

// ─── Admin: listar todos os cadastros ───
app.get("/admin/pagamentos", adminAuth, async (req, res) => {
  try {
    // Atualiza pendentes reais do MP
    const pendentes = await pool.query("SELECT id FROM cadastros WHERE status='pending' AND tipo='pix'");
    for (const row of pendentes.rows) {
      try {
        const result = await payment.get({ id: row.id });
        if (result.status !== "pending") {
          await pool.query("UPDATE cadastros SET status=$1 WHERE id=$2", [result.status, row.id]);
        }
      } catch (e) {}
    }

    const todos = await pool.query("SELECT * FROM cadastros ORDER BY criado_em DESC");
    const aprovados = todos.rows.filter(p => p.status === "approved").length;
    const receita = todos.rows.filter(p => p.status === "approved").reduce((acc, p) => acc + (p.valor || 0), 0);

    res.json({ pagamentos: todos.rows, total: todos.rows.length, aprovados, receita });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar dados." });
  }
});

// ─── Admin: autorizar pagamento manualmente ───
app.post("/admin/autorizar/:id", adminAuth, async (req, res) => {
  await pool.query("UPDATE cadastros SET status='approved' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ─── Admin: apagar cadastro (com senha especial) ───
app.delete("/admin/apagar/:id", adminAuth, async (req, res) => {
  const { senha } = req.body;
  if (senha !== AUTH_PASS) return res.status(401).json({ error: "Senha incorreta" });
  await pool.query("DELETE FROM cadastros WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ─── Liberar acesso sem pagamento ───
app.post("/autorizar-acesso", async (req, res) => {
  const { senha, nome, email, whatsapp } = req.body;
  if (senha !== AUTH_PASS) return res.status(401).json({ error: "Senha incorreta" });
  const id = "GRATUITO-" + Date.now();
  await pool.query(
    `INSERT INTO cadastros (id, nome, email, whatsapp, status, valor, tipo) VALUES ($1,$2,$3,$4,'approved',0,'gratuito')`,
    [id, nome || "Acesso Gratuito", email || "—", whatsapp || "—"]
  );
  res.json({ ok: true });
});

// ─── Admin: login ───
app.post("/admin/login", (req, res) => {
  const { senha } = req.body;
  if (senha === ADMIN_PASS) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static("public"));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Alcateia rodando na porta ${PORT}`));
