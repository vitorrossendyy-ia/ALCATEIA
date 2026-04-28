const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// ─── Configuração Mercado Pago ───
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || "TEST-1411058631952367-042813-2293bc803e953dc2aff159288614561d-256824285",
});
const payment = new Payment(client);

// ─── Senha do admin ───
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "alcateia2024";

// ─── Histórico em memória ───
const pagamentos = [];

// ─── Middleware admin ───
function adminAuth(req, res, next) {
  const senha = req.headers["x-admin-password"];
  if (senha !== ADMIN_PASS) return res.status(401).json({ error: "Não autorizado" });
  next();
}

// ─── Criar Pix ───
app.post("/criar-pix", async (req, res) => {
  try {
    const { nome, email } = req.body;

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

    // Salva no histórico
    pagamentos.unshift({
      id: result.id,
      nome: nome || "—",
      email: email || "—",
      status: result.status,
      valor: 99,
      criado_em: new Date().toISOString(),
    });

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
    const result = await payment.get({ id: req.params.id });

    // Atualiza status no histórico
    const p = pagamentos.find(p => String(p.id) === String(req.params.id));
    if (p) p.status = result.status;

    res.json({ status: result.status });
  } catch (err) {
    console.error("Erro ao verificar:", err);
    res.status(500).json({ error: "Erro ao verificar pagamento." });
  }
});

// ─── API Admin: listar pagamentos ───
app.get("/admin/pagamentos", adminAuth, async (req, res) => {
  // Atualiza status de todos os pendentes
  for (const p of pagamentos) {
    if (p.status === "pending") {
      try {
        const result = await payment.get({ id: p.id });
        p.status = result.status;
      } catch (e) {}
    }
  }
  res.json({ pagamentos, total: pagamentos.length, aprovados: pagamentos.filter(p => p.status === "approved").length });
});

// ─── API Admin: verificar senha ───
app.post("/admin/login", (req, res) => {
  const { senha } = req.body;
  if (senha === ADMIN_PASS) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

// ─── Painel admin (rota protegida) ───
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ─── Servir frontend ───
app.use(express.static("public"));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Alcateia rodando na porta ${PORT}`);
});
