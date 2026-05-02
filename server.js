const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8000);
const CLIENT_ACCESS_CODE = process.env.CLIENT_ACCESS_CODE || "cliente2026";
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || "admin2026";
const SESSION_SECRET = process.env.SESSION_SECRET || "troque-este-segredo";
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 60 * 1024 * 1024);

const ROOT_DIR = __dirname;
const RAILWAY_VOLUME_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || "";
const DEFAULT_DATA_DIR = RAILWAY_VOLUME_DIR
  ? path.join(RAILWAY_VOLUME_DIR, "data")
  : path.join(ROOT_DIR, "data");
const DEFAULT_MATERIALS_DIR = RAILWAY_VOLUME_DIR
  ? path.join(RAILWAY_VOLUME_DIR, "materiais")
  : path.join(ROOT_DIR, "materiais");
const MATERIALS_DIR = path.resolve(process.env.MATERIALS_DIR || DEFAULT_MATERIALS_DIR);
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);
const DATA_FILE = path.join(DATA_DIR, "materials.json");
const CLIENT_CODES_FILE = path.join(DATA_DIR, "client-codes.json");

const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

ensureStorage();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, {
      message: error.status ? error.message : "Erro interno.",
    });
  }
});

server.listen(PORT, () => {
  console.log(`Portal de materiais em http://127.0.0.1:${PORT}`);
});

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/access") {
    const body = await readJson(request);
    const access = getAccessForCode(body.code);

    if (!access) {
      sendJson(response, 401, { message: "Código inválido." });
      return;
    }

    response.setHeader("Set-Cookie", createSessionCookie(access));
    sendJson(response, 200, { role: access.role, clientName: access.clientName || null });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    const session = getSession(request);
    sendJson(response, 200, {
      authenticated: Boolean(session),
      role: session?.role || "guest",
      clientName: session?.clientName || null,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/logout") {
    response.setHeader(
      "Set-Cookie",
      "portal_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    );
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/materials") {
    requireRole(request, response, ["client", "admin"], () => {
      sendJson(response, 200, readMaterials().map(toPublicMaterial));
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/materials") {
    await requireRole(request, response, ["admin"], async () => {
      const material = await receiveMaterial(request);
      sendJson(response, 201, toPublicMaterial(material));
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/client-codes") {
    requireRole(request, response, ["admin"], () => {
      sendJson(response, 200, readClientCodes().map(toPublicClientCode));
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/client-codes") {
    await requireRole(request, response, ["admin"], async () => {
      const body = await readJson(request);
      const clientCode = createClientCode(body);
      sendJson(response, 201, toPublicClientCode(clientCode));
    });
    return;
  }

  const clientCodeMatch = url.pathname.match(/^\/api\/client-codes\/([^/]+)$/);
  if (request.method === "PATCH" && clientCodeMatch) {
    await requireRole(request, response, ["admin"], async () => {
      const body = await readJson(request);
      const clientCode = updateClientCode(decodeURIComponent(clientCodeMatch[1]), body);
      sendJson(response, 200, toPublicClientCode(clientCode));
    });
    return;
  }

  if (request.method === "DELETE" && clientCodeMatch) {
    requireRole(request, response, ["admin"], () => {
      deleteClientCode(response, decodeURIComponent(clientCodeMatch[1]));
    });
    return;
  }

  const pdfMatch = url.pathname.match(/^\/api\/materials\/([^/]+)\/pdf$/);
  if (request.method === "GET" && pdfMatch) {
    requireRole(request, response, ["client", "admin"], () => {
      streamPdf(response, decodeURIComponent(pdfMatch[1]));
    });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/materials\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    requireRole(request, response, ["admin"], () => {
      deleteMaterial(response, decodeURIComponent(deleteMatch[1]));
    });
    return;
  }

  sendJson(response, 404, { message: "Rota não encontrada." });
}

function requireRole(request, response, roles, callback) {
  const session = getSession(request);
  if (!session || !roles.includes(session.role)) {
    sendJson(response, 403, { message: "Acesso negado." });
    return undefined;
  }

  return callback();
}

function getAccessForCode(code) {
  const normalizedCode = normalizeAccessCode(code);

  if (code === ADMIN_ACCESS_CODE) {
    return { role: "admin" };
  }

  if (code === CLIENT_ACCESS_CODE) {
    return { role: "client" };
  }

  const clientCodes = readClientCodes();
  const clientCode = clientCodes.find(
    (item) => item.active && normalizeAccessCode(item.code) === normalizedCode,
  );

  if (clientCode) {
    clientCode.lastUsedAt = new Date().toISOString();
    clientCode.uses = Number(clientCode.uses || 0) + 1;
    writeClientCodes(clientCodes);
    return {
      role: "client",
      clientCodeId: clientCode.id,
      clientName: clientCode.clientName,
    };
  }

  return null;
}

function createSessionCookie(access) {
  const expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  const clientCodeId = access.clientCodeId || "default";
  const value = `${access.role}.${clientCodeId}.${expiresAt}`;
  const signature = sign(value);
  return `portal_session=${value}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
}

function getSession(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const session = cookies.portal_session;
  if (!session) {
    return null;
  }

  const parts = session.split(".");
  let role;
  let clientCodeId;
  let expiresAt;
  let signature;
  let value;

  if (parts.length === 3) {
    [role, expiresAt, signature] = parts;
    value = `${role}.${expiresAt}`;
  } else {
    [role, clientCodeId, expiresAt, signature] = parts;
    value = `${role}.${clientCodeId}.${expiresAt}`;
  }

  if (!role || !expiresAt || !signature || signature !== sign(value)) {
    return null;
  }

  if (Number(expiresAt) < Date.now()) {
    return null;
  }

  if (!["client", "admin"].includes(role)) {
    return null;
  }

  if (role === "client" && clientCodeId && clientCodeId !== "default") {
    const clientCode = readClientCodes().find(
      (item) => item.id === clientCodeId && item.active,
    );

    if (!clientCode) {
      return null;
    }

    return { role, clientCodeId, clientName: clientCode.clientName };
  }

  return { role };
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function parseCookies(cookieHeader) {
  return cookieHeader.split(";").reduce((cookies, cookie) => {
    const [key, ...value] = cookie.trim().split("=");
    if (key) {
      cookies[key] = decodeURIComponent(value.join("="));
    }
    return cookies;
  }, {});
}

async function receiveMaterial(request) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];

  if (!boundary) {
    throw createHttpError(400, "Upload inválido.");
  }

  const body = await readBuffer(request, MAX_UPLOAD_BYTES);
  const parts = parseMultipart(body, boundary);
  const fields = {};
  let pdfPart = null;

  parts.forEach((part) => {
    if (!part.name) {
      return;
    }

    if (part.filename) {
      pdfPart = part;
      return;
    }

    fields[part.name] = part.content.toString("utf8").trim();
  });

  if (!pdfPart || !isPdfPart(pdfPart)) {
    throw createHttpError(400, "Selecione um arquivo PDF válido.");
  }

  const id = crypto.randomUUID();
  const originalName = sanitizeFileName(pdfPart.filename || "material.pdf");
  const storedName = `${id}.pdf`;
  const storedPath = path.join(MATERIALS_DIR, storedName);
  fs.writeFileSync(storedPath, pdfPart.content);

  const materials = readMaterials();
  const material = {
    id,
    title: fields.title || cleanFileName(originalName),
    category: fields.category || "Material",
    description: fields.description || "",
    originalName,
    storedName,
    createdAt: new Date().toISOString(),
  };

  materials.unshift(material);
  writeMaterials(materials);
  return material;
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const chunks = splitBuffer(body, delimiter).slice(1, -1);

  return chunks.map((chunk) => {
    let part = chunk;
    if (part.subarray(0, 2).equals(Buffer.from("\r\n"))) {
      part = part.subarray(2);
    }

    if (part.subarray(part.length - 2).equals(Buffer.from("\r\n"))) {
      part = part.subarray(0, part.length - 2);
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      return {};
    }

    const rawHeaders = part.subarray(0, headerEnd).toString("utf8");
    const content = part.subarray(headerEnd + 4);
    const disposition = rawHeaders
      .split("\r\n")
      .find((line) => line.toLowerCase().startsWith("content-disposition")) || "";

    return {
      name: disposition.match(/name="([^"]+)"/)?.[1],
      filename: disposition.match(/filename="([^"]*)"/)?.[1],
      headers: rawHeaders,
      content,
    };
  });
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }

  parts.push(buffer.subarray(start));
  return parts;
}

function isPdfPart(part) {
  const filenameIsPdf = (part.filename || "").toLowerCase().endsWith(".pdf");
  const headerIsPdf = part.content.subarray(0, 4).toString("utf8") === "%PDF";
  return filenameIsPdf && headerIsPdf;
}

function streamPdf(response, id) {
  const material = readMaterials().find((item) => item.id === id);
  if (!material) {
    sendJson(response, 404, { message: "Material não encontrado." });
    return;
  }

  const filePath = path.join(MATERIALS_DIR, material.storedName);
  if (!isInsideDirectory(MATERIALS_DIR, filePath) || !fs.existsSync(filePath)) {
    sendJson(response, 404, { message: "Arquivo não encontrado." });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${encodeHeaderValue(material.originalName)}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });

  fs.createReadStream(filePath).pipe(response);
}

function deleteMaterial(response, id) {
  const materials = readMaterials();
  const material = materials.find((item) => item.id === id);
  if (!material) {
    sendJson(response, 404, { message: "Material não encontrado." });
    return;
  }

  const nextMaterials = materials.filter((item) => item.id !== id);
  writeMaterials(nextMaterials);

  const filePath = path.join(MATERIALS_DIR, material.storedName);
  if (isInsideDirectory(MATERIALS_DIR, filePath) && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  sendJson(response, 200, { ok: true });
}

async function serveStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT_DIR, safePath));

  if (!isInsideDirectory(ROOT_DIR, filePath) || isInsideDirectory(MATERIALS_DIR, filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": staticTypes[path.extname(filePath)] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(response);
}

function readMaterials() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeMaterials(materials) {
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(materials, null, 2)}\n`);
}

function readClientCodes() {
  try {
    const data = JSON.parse(fs.readFileSync(CLIENT_CODES_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeClientCodes(clientCodes) {
  fs.writeFileSync(CLIENT_CODES_FILE, `${JSON.stringify(clientCodes, null, 2)}\n`);
}

function toPublicMaterial(material) {
  return {
    id: material.id,
    title: material.title,
    category: material.category,
    description: material.description,
    createdAt: material.createdAt,
  };
}

function toPublicClientCode(clientCode) {
  return {
    id: clientCode.id,
    clientName: clientCode.clientName,
    code: clientCode.code,
    active: clientCode.active,
    createdAt: clientCode.createdAt,
    lastUsedAt: clientCode.lastUsedAt || null,
    uses: Number(clientCode.uses || 0),
  };
}

function createClientCode(input) {
  const clientName = String(input.clientName || "").trim();
  const customCode = String(input.code || "").trim();

  if (!clientName) {
    throw createHttpError(400, "Informe o nome do cliente.");
  }

  const clientCodes = readClientCodes();
  const code = customCode ? normalizeAccessCode(customCode) : generateUniqueClientCode();

  validateClientCode(code);

  if (isCodeInUse(code, clientCodes)) {
    throw createHttpError(409, "Este código já está em uso.");
  }

  const clientCode = {
    id: crypto.randomUUID(),
    clientName,
    code,
    active: true,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    uses: 0,
  };

  clientCodes.unshift(clientCode);
  writeClientCodes(clientCodes);
  return clientCode;
}

function updateClientCode(id, input) {
  const clientCodes = readClientCodes();
  const clientCode = clientCodes.find((item) => item.id === id);

  if (!clientCode) {
    throw createHttpError(404, "Código não encontrado.");
  }

  if (typeof input.active !== "boolean") {
    throw createHttpError(400, "Informe se o código deve ficar ativo.");
  }

  clientCode.active = input.active;
  clientCode.updatedAt = new Date().toISOString();
  writeClientCodes(clientCodes);
  return clientCode;
}

function deleteClientCode(response, id) {
  const clientCodes = readClientCodes();
  const clientCode = clientCodes.find((item) => item.id === id);

  if (!clientCode) {
    sendJson(response, 404, { message: "Código não encontrado." });
    return;
  }

  writeClientCodes(clientCodes.filter((item) => item.id !== id));
  sendJson(response, 200, { ok: true });
}

function ensureStorage() {
  fs.mkdirSync(MATERIALS_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    writeMaterials([]);
  }

  if (!fs.existsSync(CLIENT_CODES_FILE)) {
    writeClientCodes([]);
  }
}

function readJson(request) {
  return readBuffer(request, 1024 * 1024).then((buffer) => {
    if (buffer.length === 0) {
      return {};
    }
    return JSON.parse(buffer.toString("utf8"));
  });
}

function readBuffer(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(createHttpError(413, "Arquivo muito grande."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sanitizeFileName(fileName) {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._ -]/g, "").trim() || "material.pdf";
}

function cleanFileName(fileName) {
  return fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
}

function normalizeAccessCode(code) {
  return String(code || "").trim().toUpperCase();
}

function validateClientCode(code) {
  if (!/^[A-Z0-9-]{6,32}$/.test(code)) {
    throw createHttpError(
      400,
      "Use um código com 6 a 32 caracteres, apenas letras, números e hífen.",
    );
  }
}

function generateUniqueClientCode() {
  const clientCodes = readClientCodes();
  let code = "";

  do {
    code = `CLI-${randomCodeSegment()}-${randomCodeSegment()}`;
  } while (isCodeInUse(code, clientCodes));

  return code;
}

function randomCodeSegment() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let segment = "";

  for (let index = 0; index < 4; index += 1) {
    segment += alphabet[crypto.randomInt(0, alphabet.length)];
  }

  return segment;
}

function isCodeInUse(code, clientCodes) {
  const normalizedCode = normalizeAccessCode(code);
  return (
    normalizeAccessCode(ADMIN_ACCESS_CODE) === normalizedCode ||
    normalizeAccessCode(CLIENT_ACCESS_CODE) === normalizedCode ||
    clientCodes.some((item) => normalizeAccessCode(item.code) === normalizedCode)
  );
}

function encodeHeaderValue(value) {
  return String(value).replace(/["\r\n]/g, "");
}

function isInsideDirectory(directory, filePath) {
  const relative = path.relative(directory, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
