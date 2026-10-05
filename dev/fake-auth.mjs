// Backend falso com o contrato do POST /auth/login do i-monitor, só para desenvolvimento.
// Usuários (senha "123456"): master, operador, inspetor, bloqueado, trocasenha.
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_AUTH_PORT ?? 3999);
const USERS = {
  master: { alias_level: 'Master', customer_id: 'fractal', operator_type: '' },
  operador: { alias_level: 'Operator', customer_id: 'empresa-demo', operator_type: 'stuffer' },
  inspetor: { alias_level: 'Operator', customer_id: 'empresa-demo', operator_type: 'inspector' },
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || !req.url.endsWith('/auth/login')) return send(404, { message: 'Not Found' });
    const { username, password } = JSON.parse(raw || '{}');
    // Mesmo formato do AllExceptionsFilter dos backends reais (sem o campo code).
    const error = (status, message) => send(status, { statusCode: status, timestamp: new Date().toISOString(), path: req.url, message, reasons: [] });
    if (username === 'bloqueado') return error(403, 'User is blocked. Please try again in 3 minute(s).');
    if (password !== '123456') return error(401, 'Invalid credentials');
    if (username === 'trocasenha') return send(200, { setNewPassword: true });
    const claims = USERS[username];
    if (!claims) return error(401, 'Invalid credentials');
    send(200, { access_token: `${b64({ alg: 'HS256' })}.${b64({ username, sub: username, ...claims })}.dev`, refresh_token: 'dev', role: '' });
  });
}).listen(PORT, () => console.log(`fake-auth em http://localhost:${PORT}`));
