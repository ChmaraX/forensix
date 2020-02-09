import React, { useEffect, useState } from "react";
import { Grid, Segment, Statistic, Icon } from "semantic-ui-react";
import Sidemenu from "./Sidemenu/Sidemenu";
import TopBar from "./TopBar/TopBar";
import Profile from "./Widgets/Profile/Profile";
import axios from "axios";
import SystemSpecs from "./Widgets/SystemSpecs/SystemSpecs";

function DashboardContainer() {
  const [profile, setProfile] = useState();
  const [accounts, setAccounts] = useState();
  const [systemSpecs, setSystemSpecs] = useState();
  const [loading, setLoading] = useState(true);

  function fetchData() {
    let profile = axios.get("/profile/estimate").then(res => {
      setProfile(res.data);
    });

    let accounts = axios.get("/profile/accounts").then(res => {
      setAccounts(res.data);
    });

    let systemSpecs = axios.get("/profile/system-specs").then(res => {
      setSystemSpecs(res.data.specs);
    });

    Promise.all([profile, accounts, systemSpecs]).then(() => {
      setLoading(false);
    });
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div>
      <Sidemenu />
      <TopBar />
      <div style={{ margin: "30px 30px 30px 330px" }}>
        <Grid columns="equal" stretched>
          <Grid.Row>
            <Grid.Column width={6}>
              <Profile
                profile={profile}
                accounts={accounts}
                loading={loading}
              />
            </Grid.Column>
            <Grid.Column>
              <SystemSpecs systemSpecs={systemSpecs} />
            </Grid.Column>
            <Grid.Column width={6}>
              <Segment raised>3</Segment>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column>
              <Segment>1</Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment>2</Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment>3</Segment>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column>
              <Segment>1</Segment>
            </Grid.Column>
            <Grid.Column>
              <Segment>2</Segment>
            </Grid.Column>
          </Grid.Row>
        </Grid>
      </div>
    </div>
  );
}

export default DashboardContainer;
