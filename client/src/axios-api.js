import axios from "axios";

// change protocol to https in case of https
var baseURL = `http://${window.location.hostname}:3001`;

if (process.env.REACT_APP_DEV) {
  baseURL = "http://localhost:3001";
}

const instance = axios.create({
  baseURL: baseURL
});

export default instance;
