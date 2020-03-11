import axios from "axios";

const instance = axios.create({
  baseURL: `${window.location.protocol}//${window.location.hostname}:${window.location.port}/api`
});

export default instance;
