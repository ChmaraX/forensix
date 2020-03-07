import {
  STORE_DASHBOARD_DATA,
  STORE_HISTORY_DATA,
  STORE_LOGIN_DATA,
  STORE_WEB_DATA,
  STORE_DOWNLOADS_DATA,
  STORE_BOOKMARKS_DATA,
  STORE_FAVICONS_DATA,
  STORE_CACHE_DATA,
  STORE_DIR_TREE_DATA,
  STORE_VOLUMES_INFO
} from "../actions/appData";

const initialState = {
  dashboard: {
    profile: null,
    accounts: null,
    systemSpecs: null,
    classifiedUrls: null,
    credentials: null,
    bActivity: null,
    topSites: null
  },
  history: {
    history: null,
    bActivity: null,
    avgDurations: null
  },
  loginData: null,
  webData: {
    autofills: null,
    geo: null,
    phonenums: null
  },
  downloadsData: {
    downloads: null,
    meta: null
  },
  bookmarks: null,
  favicons: null,
  cache: null,
  dirTree: null,
  volumesInfo: {
    status: null,
    volume: null
  }
};

const reducer = (state = initialState, action) => {
  switch (action.type) {
    case STORE_DASHBOARD_DATA: {
      const { dashboard } = action;
      return { ...state, dashboard: { ...state.dashboard, ...dashboard } };
    }
    case STORE_HISTORY_DATA: {
      const { history } = action;
      return { ...state, history: { ...state.history, ...history } };
    }
    case STORE_LOGIN_DATA: {
      const { loginData } = action;
      return { ...state, loginData };
    }
    case STORE_WEB_DATA: {
      const { webData } = action;
      return { ...state, webData: { ...state.webData, ...webData } };
    }
    case STORE_DOWNLOADS_DATA: {
      const { downloadsData } = action;
      return {
        ...state,
        downloadsData: { ...state.downloadsData, ...downloadsData }
      };
    }
    case STORE_BOOKMARKS_DATA: {
      const { bookmarks } = action;
      return { ...state, bookmarks };
    }
    case STORE_FAVICONS_DATA: {
      const { favicons } = action;
      return { ...state, favicons };
    }
    case STORE_CACHE_DATA: {
      const { cache } = action;
      return { ...state, cache };
    }
    case STORE_DIR_TREE_DATA: {
      const { dirTree } = action;
      return { ...state, dirTree };
    }
    case STORE_VOLUMES_INFO: {
      const { volumesInfo } = action;
      return { ...state, volumesInfo };
    }
    default:
      break;
  }
  return state;
};

export default reducer;
