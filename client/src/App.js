import React from "react";
import Login from "./login/Login";
import VolumeMenu from "./volumeMenu/VolumeMenu";
import DashboardContainer from "./dashboard/DashboardContainer";
import { BrowserRouter as Router, Switch, Route } from "react-router-dom";

function App() {
  return (
    <Router>
      <Switch>
        <Route path="/volumes" component={VolumeMenu} />
        <Route path="/dashboard" component={DashboardContainer} />
        <Route path="/" component={Login} />
      </Switch>
    </Router>
  );
}

export default App;
