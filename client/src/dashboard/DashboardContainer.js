import React, { useEffect, useState } from "react";
import { Grid } from "semantic-ui-react";
import Profile from "./Widgets/Profile/Profile";
import axios from "axios";
import SystemSpecs from "./Widgets/SystemSpecs/SystemSpecs";
import RadarWidget from "./Widgets/RadarWidget/RadarWidget";
import LoginPie from "./Widgets/LoginPie/LoginPie";
import BrowsingActivty from "./Widgets/BrowsingActivity/BrowsingActivity";
import TopSites from "./Widgets/TopSites/TopSites";
import UserActivity from "./Widgets/UserActivity/UserActivity";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";

function DashboardContainer() {
  const [profile, setProfile] = useState();
  const [accounts, setAccounts] = useState();
  const [systemSpecs, setSystemSpecs] = useState();
  const [classified, setClassified] = useState();
  const [credentials, setCredentials] = useState();
  const [bActivity, setbActivity] = useState();
  const [topSites, setTopSites] = useState();
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

    // let classifiedUrls = axios.get("/history/classify").then(res => {
    //   setClassified(res.data.classified_urls);
    // });

    let credentials = axios.get("/logindata/credentials").then(res => {
      setCredentials(res.data);
    });

    let bActivity = axios.get("/history/activity").then(res => {
      setbActivity(res.data);
    });

    let topSites = axios.get("/topsites").then(res => {
      setTopSites(res.data);
    });

    Promise.all([profile, accounts, systemSpecs]).then(() => {
      setLoading(false);
    });
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <ContentWrapper>
      <Grid columns="equal" stretched>
        <Grid.Row>
          <Grid.Column width={6}>
            <Profile profile={profile} accounts={accounts} loading={loading} />
          </Grid.Column>
          <Grid.Column>
            <SystemSpecs systemSpecs={systemSpecs} />
          </Grid.Column>
          <Grid.Column width={6}>
            <RadarWidget classified={classified} />
          </Grid.Column>
        </Grid.Row>
        <Grid.Row>
          <Grid.Column width={6}>
            <LoginPie credentials={credentials} />
          </Grid.Column>
          <Grid.Column>
            <BrowsingActivty bActivity={bActivity} />
          </Grid.Column>
        </Grid.Row>
        <Grid.Row>
          <Grid.Column>
            <TopSites topSites={topSites} />
          </Grid.Column>
          <Grid.Column>
            <UserActivity topSites={topSites} />
          </Grid.Column>
        </Grid.Row>
      </Grid>
    </ContentWrapper>
  );
}

export default DashboardContainer;
