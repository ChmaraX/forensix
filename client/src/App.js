import React from "react";
import Login from "./login/Login";
import VolumeMenu from "./volumeMenu/VolumeMenu";
import DashboardContainer from "./dashboard/DashboardContainer";
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";
import HistoryContainer from "./history/HistoryContainer";
import DownloadsContainer from "./downloads/DownloadsContainer";
import FaviconsContainer from "./favicons/FaviconsContainer";
import LoginDataContainer from "./logindata/LoginDataContainer";
import WebDataContainer from "./webdata/WebDataContainer";
import VolumesContainer from "./volumes/VolumesContainer";
import CacheContainer from "./cache/CacheContainer";
import BookmarksContainer from "./bookmarks/BookmarksContainer";

function App() {
  return (
    <Router>
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
        <Route path="/" component={Login} />
      </Switch>
    </Router>
  );
}

export default App;
