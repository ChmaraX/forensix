import React, { useEffect } from "react";
import Login from "./login/Login";
import VolumeMenu from "./volumeMenu/VolumeMenu";
import DashboardContainer from "./dashboard/DashboardContainer";
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect
} from "react-router-dom";
import HistoryContainer from "./history/HistoryContainer";
import DownloadsContainer from "./downloads/DownloadsContainer";
import FaviconsContainer from "./favicons/FaviconsContainer";
import LoginDataContainer from "./logindata/LoginDataContainer";
import WebDataContainer from "./webdata/WebDataContainer";
import VolumesContainer from "./volumes/VolumesContainer";
import CacheContainer from "./cache/CacheContainer";
import BookmarksContainer from "./bookmarks/BookmarksContainer";

import { useSelector, useDispatch } from "react-redux";
import { authCheckState } from "./store/actions/auth";

function App() {
  const isAuth = useSelector(state => state.authReducer.token !== null);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(authCheckState());
  }, []);

  console.log(isAuth);
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
