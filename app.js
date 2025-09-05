require('dotenv').config();
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode'); // Para generar QR como string base64

const app = express();
app.use(express.json()); // Para parsear el cuerpo de las peticiones en JSON

const EVOLUTION_API_BASE_URL = process.env.EVOLUTION_API_BASE_URL;
const PORT = process.env.PORT || 3000; // Usa el puerto de Railway o 3000 localmente

if (!EVOLUTION_API_BASE_URL) {
    console.error('Error: EVOLUTION_API_BASE_URL no está configurada en las variables de entorno.');
    process.exit(1);
}

console.log(`EVOLUTION_API_BASE_URL: ${EVOLUTION_API_BASE_URL}`);

// --- Funciones de Evolution API ---

/**
 * Genera una nueva instancia y su token, devolviendo el QR en base64.
 * @param {string} instanceName El nombre deseado para la instancia.
 * @returns {Promise<{instanceName: string, token: string, qrCodeDataUrl: string}|null>}
 */
async function generarInstanciaYQR(instanceName) {
    console.log(`[${instanceName}] Intentando generar/obtener QR.`);
    try {
        const url = `${EVOLUTION_API_BASE_URL}connection/generate-token/${instanceName}`;
        const response = await axios.get(url);

        if (response.data && response.data.status === 'success') {
            const { qrcode: qrData, instance, token } = response.data;
            console.log(`[${instance}] Instancia generada/actualizada. Token: ${token.substring(0, 5)}...`);

            // Generar el QR como Data URL (base64) para enviar al frontend
            const qrCodeDataUrl = await qrcode.toDataURL(qrData);

            return { instanceName: instance, token: token, qrCodeDataUrl: qrCodeDataUrl };
        } else {
            console.error(`[${instanceName}] Error al generar instancia y QR:`, response.data);
            return null;
        }
    } catch (error) {
        console.error(`[${instanceName}] Error de conexión o al generar instancia y QR:`, error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
        return null;
    }
}

/**
 * Verifica el estado de conexión de una instancia.
 * @param {string} instanceName
 * @param {string} token
 * @returns {Promise<string|null>} 'CONNECTED', 'DISCONNECTED', 'QRCODE', etc.
 */
async function verificarConexion(instanceName, token) {
    try {
        const response = await axios.get(
            `${EVOLUTION_API_BASE_URL}message/${instanceName}/connectionState`,
            {
                headers: { 'apikey': token }
            }
        );

        if (response.data && response.data.status === 'success') {
            return response.data.state;
        } else {
            console.error(`[${instanceName}] Error al verificar conexión:`, response.data);
            return null;
        }
    } catch (error) {
        console.error(`[${instanceName}] Error de conexión al verificar el estado:`, error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
        return null;
    }
}

/**
 * Lista los chats de una instancia conectada.
 * @param {string} instanceName
 * @param {string} token
 * @returns {Promise<Array<Object>|null>} Lista de chats.
 */
async function listarChats(instanceName, token) {
    try {
        console.log(`[${instanceName}] Intentando listar chats.`);
        const response = await axios.get(
            `${EVOLUTION_API_BASE_URL}message/${instanceName}/getChats`,
            {
                headers: { 'apikey': token }
            }
        );

        if (response.data && response.data.status === 'success') {
            return response.data.chats;
        } else {
            console.error(`[${instanceName}] Error al listar chats:`, response.data);
            return null;
        }
    } catch (error) {
        console.error(`[${instanceName}] Error de conexión o al listar chats:`, error.message);
        if (error.response) {
            console.error('Detalles del error:', error.response.data);
        }
        return null;
    }
}

// --- Rutas de la API de tu Chatbot ---

// Ruta de salud para verificar que el servicio está activo
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Chatbot service is running!',
        evolutionApiBaseUrl: EVOLUTION_API_BASE_URL // Para depuración
    });
});

/**
 * POST /instance/generate
 * Crea o actualiza una instancia de WhatsApp y devuelve el QR para escanear.
 * Requiere un `instanceName` en el cuerpo de la petición.
 */
app.post('/instance/generate', async (req, res) => {
    const { instanceName } = req.body;

    if (!instanceName) {
        return res.status(400).json({ status: 'error', message: 'El nombre de la instancia (instanceName) es requerido.' });
    }

    const instanceData = await generarInstanciaYQR(instanceName);

    if (instanceData) {
        res.status(200).json({
            status: 'success',
            message: 'Instancia generada/actualizada. Escanea el QR para conectar.',
            instanceName: instanceData.instanceName,
            token: instanceData.token, // CUIDADO: En producción, no expongas el token directamente
            qrCodeDataUrl: instanceData.qrCodeDataUrl, // QR en base64 para tu frontend
            qrCodeImageUrl: `${EVOLUTION_API_BASE_URL}connection/qrcode/${instanceData.instanceName}` // URL directa del QR
        });
    } else {
        res.status(500).json({ status: 'error', message: 'No se pudo generar la instancia o el QR.' });
    }
});

/**
 * GET /instance/:instanceName/status
 * Verifica el estado de conexión de una instancia específica.
 * Requiere el token de la instancia en el header `x-api-key`.
 */
app.get('/instance/:instanceName/status', async (req, res) => {
    const { instanceName } = req.params;
    const token = req.headers['x-api-key'];

    if (!token) {
        return res.status(401).json({ status: 'error', message: 'Token de API (x-api-key) requerido en los headers.' });
    }

    const connectionState = await verificarConexion(instanceName, token);

    if (connectionState) {
        res.status(200).json({
            status: 'success',
            instanceName: instanceName,
            connectionState: connectionState
        });
    } else {
        res.status(500).json({ status: 'error', message: 'No se pudo obtener el estado de la conexión.' });
    }
});

/**
 * GET /instance/:instanceName/chats
 * Lista los chats de una instancia conectada.
 * Requiere el token de la instancia en el header `x-api-key`.
 */
app.get('/instance/:instanceName/chats', async (req, res) => {
    const { instanceName } = req.params;
    const token = req.headers['x-api-key'];

    if (!token) {
        return res.status(401).json({ status: 'error', message: 'Token de API (x-api-key) requerido en los headers.' });
    }

    const connectionState = await verificarConexion(instanceName, token);

    if (connectionState !== 'CONNECTED') {
        return res.status(400).json({
            status: 'error',
            message: `La instancia '${instanceName}' no está conectada. Estado actual: ${connectionState}. Escanee el QR para conectar.`,
            connectionState: connectionState
        });
    }

    const chats = await listarChats(instanceName, token);

    if (chats) {
        res.status(200).json({
            status: 'success',
            instanceName: instanceName,
            chats: chats
        });
    } else {
        res.status(500).json({ status: 'error', message: 'No se pudieron listar los chats.' });
    }
});

// --- Iniciar el Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor de chatbot escuchando en el puerto ${PORT}`);
    console.log(`Accede a http://localhost:${PORT} (o la URL de Railway)`);
    console.log(`Endpoints disponibles:`);
    console.log(`  POST /instance/generate   (para crear/generar QR)`);
    console.log(`  GET  /instance/:instanceName/status (para verificar conexión)`);
    console.log(`  GET  /instance/:instanceName/chats (para listar chats)`);
});