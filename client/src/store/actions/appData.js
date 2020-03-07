export const STORE_DASHBOARD_DATA = "STORE_DASHBOARD_DATA";
export const STORE_HISTORY_DATA = "STORE_HISTORY_DATA";
export const STORE_LOGIN_DATA = "STORE_LOGIN_DATA";
export const STORE_WEB_DATA = "STORE_WEB_DATA";
export const STORE_DOWNLOADS_DATA = "STORE_DOWNLOADS_DATA";
export const STORE_BOOKMARKS_DATA = "STORE_BOOKMARKS_DATA";
export const STORE_FAVICONS_DATA = "STORE_FAVICONS_DATA";
export const STORE_CACHE_DATA = "STORE_CACHE_DATA";
export const STORE_DIR_TREE_DATA = "STORE_DIR_TREE_DATA";
export const STORE_VOLUMES_INFO = "STORE_VOLUMES_INFO";

export const storeDashboardData = dashboard => {
  return {
    type: STORE_DASHBOARD_DATA,
    dashboard: dashboard
  };
};

export const storeHistoryData = history => {
  return {
    type: STORE_HISTORY_DATA,
    history: history
  };
};

export const storeLogindata = loginData => {
  return {
    type: STORE_LOGIN_DATA,
    loginData: loginData
  };
};

export const storeWebData = webData => {
  return {
    type: STORE_WEB_DATA,
    webData: webData
  };
};

export const storeDownloadsData = downloadsData => {
  return {
    type: STORE_DOWNLOADS_DATA,
    downloadsData: downloadsData
  };
};

export const storeBookmarksData = bookmarks => {
  return {
    type: STORE_BOOKMARKS_DATA,
    bookmarks: bookmarks
  };
};

export const storeFaviconsData = favicons => {
  return {
    type: STORE_FAVICONS_DATA,
    favicons: favicons
  };
};

export const storeVolumesInfo = volumesInfo => {
  return {
    type: STORE_VOLUMES_INFO,
    volumesInfo: volumesInfo
  };
};

export const storeCacheData = cache => {
  return {
    type: STORE_CACHE_DATA,
    cache: cache
  };
};

export const storeDirTreeData = dirTree => {
  return {
    type: STORE_DIR_TREE_DATA,
    dirTree: dirTree
  };
};
