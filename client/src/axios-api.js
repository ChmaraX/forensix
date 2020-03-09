import axios from "axios";

const API_PORT = process.env.API_PORT || 3001;
const API_HOST = process.env.API_HOST || "localhost";

const instance = axios.create({
  baseURL: `https://${API_HOST}:${API_PORT}`
});

export default instance;
