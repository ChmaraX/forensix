import {
  AUTH_FAIL,
  AUTH_LOGOUT,
  AUTH_START,
  AUTH_SUCCESS
} from "../actions/auth";

const initialState = {
  error: null,
  loading: false,
  token: null,
  username: null
};

const reducer = (state = initialState, action) => {
  switch (action.type) {
    case AUTH_START: {
      return { ...state, error: null, loading: true };
    }
    case AUTH_FAIL: {
      const { error } = action;
      return { ...state, error, loading: false };
    }
    case AUTH_SUCCESS: {
      const { username, token } = action;
      return { ...state, username, token, error: null, loading: false };
    }
    case AUTH_LOGOUT: {
      return { ...state, error: null, token: null, username: null };
    }
    default:
      break;
  }
  return state;
};

export default reducer;
