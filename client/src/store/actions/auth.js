import axios from "../../axios-api";

export const AUTH_START = "AUTH_START";
export const AUTH_SUCCESS = "AUTH_SUCCESS";
export const AUTH_FAIL = "AUTH_FAIL";
export const AUTH_LOGOUT = "AUTH_LOGOUT";

export const authStart = () => {
  return { type: AUTH_START };
};

export const authSuccess = authData => {
  return {
    type: AUTH_SUCCESS,
    token: authData.token,
    username: authData?.user?.username || authData.username
  };
};

export const authFail = error => {
  return { type: AUTH_FAIL, error };
};

export const logout = () => {
  localStorage.removeItem("token");
  localStorage.removeItem("username");
  return { type: AUTH_LOGOUT };
};

export const authCheckState = () => {
  return dispatch => {
    const token = localStorage.getItem("token");
    if (!token) {
      dispatch(logout());
    } else {
      const username = localStorage.getItem("username");
      dispatch(authSuccess({ token, username }));
    }
  };
};

export const auth = (username, password) => {
  return dispatch => {
    dispatch(authStart());
    const authData = {
      username: username,
      password: password
    };

    axios
      .post("/users/login", authData)
      .then(res => {
        
        localStorage.setItem("token", res.data.token);
        localStorage.setItem("username", res.data.user.username);
        
        dispatch(authSuccess(res.data));
      })
      .catch(err => {
        dispatch(authFail(err));
      });
  };
};
