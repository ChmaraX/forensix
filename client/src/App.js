import React, { useEffect } from "react";
import Login from "./login/Login";
import VolumeMenu from "./volumeMenu/VolumeMenu";
import DashboardContainer from "./views/dashboard/DashboardContainer";
import HistoryContainer from "./views/history/HistoryContainer";
import DownloadsContainer from "./views/downloads/DownloadsContainer";
import FaviconsContainer from "./views/favicons/FaviconsContainer";
import LoginDataContainer from "./views/logindata/LoginDataContainer";
import WebDataContainer from "./views/webdata/WebDataContainer";
import VolumesContainer from "./views/volumes/VolumesContainer";
import CacheContainer from "./views/cache/CacheContainer";
import BookmarksContainer from "./views/bookmarks/BookmarksContainer";
import DatabaseContainer from "./views/database/DatabaseContainer";
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect
} from "react-router-dom";

import { useSelector, useDispatch } from "react-redux";
import { authCheckState } from "./store/actions/auth";

function App() {
  const isAuth = useSelector(state => state.authReducer.token !== null);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(authCheckState());
  }, []);

  let authRoutes = (
    <Switch>
      <Route path="/volumes" component={VolumeMenu} />
      <Route path="/dashboard" component={DashboardContainer} />
      <Route path="/history" component={HistoryContainer} />
      <Route path="/downloads" component={DownloadsContainer} />
      <Route path="/favicons" component={FaviconsContainer} />
      <Route path="/logindata" component={LoginDataContainer} />
      <Route path="/webdata" component={WebDataContainer} />
      <Route path="/volume" component={VolumesContainer} />
      <Route path="/cache" component={CacheContainer} />
      <Route path="/bookmarks" component={BookmarksContainer} />
      <Route path="/database" component={DatabaseContainer} />
      <Redirect from="/" to="/volumes" />
    </Switch>
  );

  let nonAuthRoutes = (
    <Switch>
      <Route path="/" component={Login} />
    </Switch>
  );

  return <Router>{isAuth ? authRoutes : nonAuthRoutes}</Router>;
}

export default App;
