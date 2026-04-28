const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || "TEST-1411058631952367-042813-2293bc803e953dc2aff159288614561d-256824285",
});
const payment = new Payment(client);

const ADMIN_PASS = process.env.ADMIN_PASSWORD || "082751@Oreo";
const AUTH_PASS = process.env.AUTH_PASSWORD || "Oreo@autorizar2024";
const pagamentos = [];

function adminAuth(req, res, next) {
  const senha = req.headers["x-admin-password"];
  if (senha !== ADMIN_PASS) return res.status(401).json({ error: "Não autorizado" });
  next();
}

// Criar Pix
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

// Verificar pagamento (cliente fica polling aqui)
app.get("/verificar/:id", async (req, res) => {
  try {
    const p = pagamentos.find(p => String(p.id) === String(req.params.id));
    // Se foi autorizado manualmente pelo admin, retorna approved direto
    if (p && p.status === "approved") {
      return res.json({ status: "approved" });
    }
    // Senão consulta o MP
    const result = await payment.get({ id: req.params.id });
    if (p) p.status = result.status;
    res.json({ status: result.status });
  } catch (err) {
    // Se der erro na API do MP (ex: ID simulado), usa o status local
    const p = pagamentos.find(p => String(p.id) === String(req.params.id));
    if (p) return res.json({ status: p.status });
    res.status(500).json({ error: "Erro ao verificar pagamento." });
  }
});

// Admin: listar pagamentos
app.get("/admin/pagamentos", adminAuth, async (req, res) => {
  for (const p of pagamentos) {
    if (p.status === "pending" && !String(p.id).startsWith("SIMULADO")) {
      try {
        const result = await payment.get({ id: p.id });
        p.status = result.status;
      } catch (e) {}
    }
  }
  res.json({
    pagamentos,
    total: pagamentos.length,
    aprovados: pagamentos.filter(p => p.status === "approved").length
  });
});

// Autorizar acesso sem pagamento (senha especial)
app.post("/autorizar-acesso", (req, res) => {
  const { senha, nome, email } = req.body;
  if (senha !== AUTH_PASS) return res.status(401).json({ error: "Senha incorreta" });
  const entry = {
    id: "GRATUITO-" + Date.now(),
    nome: nome || "Acesso Gratuito",
    email: email || "—",
    status: "approved",
    valor: 0,
    criado_em: new Date().toISOString(),
  };
  pagamentos.unshift(entry);
  res.json({ ok: true, pagamento: entry });
});

// Admin: autorizar pagamento manualmente
app.post("/admin/autorizar/:id", adminAuth, (req, res) => {
  const p = pagamentos.find(p => String(p.id) === String(req.params.id));
  if (!p) return res.status(404).json({ error: "Pagamento não encontrado" });
  p.status = "approved";
  res.json({ ok: true });
});

// Admin: simular novo pagamento
app.post("/admin/simular", adminAuth, (req, res) => {
  const fake = {
    id: "SIMULADO-" + Date.now(),
    nome: req.body.nome || "Cliente Teste",
    email: req.body.email || "teste@alcateia.com",
    status: "pending",
    valor: 99,
    criado_em: new Date().toISOString(),
  };
  pagamentos.unshift(fake);
  res.json({ ok: true, pagamento: fake });
});

// Admin: login
app.post("/admin/login", (req, res) => {
  const { senha } = req.body;
  if (senha === ADMIN_PASS) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.use(express.static("public"));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Alcateia rodando na porta ${PORT}`);
});
