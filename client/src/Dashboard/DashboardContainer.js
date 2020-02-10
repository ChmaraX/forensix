import React, { useEffect, useState } from "react";
import { Grid, Segment } from "semantic-ui-react";
import Sidemenu from "./Sidemenu/Sidemenu";
import TopBar from "./TopBar/TopBar";
import Profile from "./Widgets/Profile/Profile";
import axios from "axios";
import SystemSpecs from "./Widgets/SystemSpecs/SystemSpecs";
import RadarWidget from "./Widgets/RadarWidget/RadarWidget";

function DashboardContainer() {
  const [profile, setProfile] = useState();
  const [accounts, setAccounts] = useState();
  const [systemSpecs, setSystemSpecs] = useState();
  const [classified, setClassified] = useState();
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

    let classifiedUrls = axios.get("/history/classify").then(res => {
      setClassified(res.data.classified_urls);
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
              <RadarWidget classified={classified} />
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
