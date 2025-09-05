import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BASE = process.env.EVOLUTION_API_BASE;
const KEY = process.env.EVOLUTION_API_KEY;

const client = axios.create({
  baseURL: BASE,
  headers: {
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 15000
});

export default {
  async listInstances() {
    const { data } = await client.get('/instances');
    return data;
  },
  async createInstance(name) {
    const { data } = await client.post('/instances', { name });
    return data;
  },
  async deleteInstance(id) {
    const { data } = await client.delete(`/instances/${id}`);
    return data;
  },
  async getQr(id) {
    const { data } = await client.get(`/instances/${id}/qr`);
    return data;
  },
  async getState(id) {
    const { data } = await client.get(`/instances/${id}/state`);
    return data;
  },
  async listChats(id) {
    const { data } = await client.get(`/instances/${id}/chats`);
    return data;
  },
  async listMessages(id, jid, cursor) {
    const { data } = await client.get(`/instances/${id}/messages`, { params: { jid, cursor }});
    return data;
  },
  async sendText(id, to, text) {
    const { data } = await client.post(`/instances/${id}/messages`, {
      type: 'text',
      to, text
    });
    return data;
  }
}
