import axios from "axios";

const API_PORT = process.env.API_PORT || 3001;
const API_HOST = process.env.API_HOST || "localhost";
const API_PROTOCOL = process.env.API_PROTOCOL || "http";

const instance = axios.create({
  baseURL: `${API_PROTOCOL}://${API_HOST}:${API_PORT}`
});

export default instance;
