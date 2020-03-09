import React, { useEffect, useState } from "react";
import { Grid } from "semantic-ui-react";
import Profile from "./components/Profile/Profile";
import axios from "../../axios-api";
import SystemSpecs from "./components/SystemSpecs/SystemSpecs";
import RadarWidget from "./components/RadarWidget/RadarWidget";
import LoginPie from "./components/LoginPie/LoginPie";
import BrowsingActivty from "./components/BrowsingActivity/BrowsingActivity";
import TopSites from "./components/TopSites/TopSites";
import UserActivity from "./components/UserActivity/UserActivity";
import ContentWrapper from "../../layout/ContentWrapper/ContentWrapper";
import { useDispatch, useSelector } from "react-redux";
import { storeDashboardData } from "../../store/actions/appData";

function DashboardContainer() {
  const dispatch = useDispatch();
  const dashboardData = useSelector(state => state.appDataReducer.dashboard);
  const [profile, setProfile] = useState(dashboardData.profile);
  const [accounts, setAccounts] = useState(dashboardData.accounts);
  const [systemSpecs, setSystemSpecs] = useState(dashboardData.systemSpecs);
  const [classifiedUrls, setClassifiedUrls] = useState(
    dashboardData.classifiedUrls
  );
  const [credentials, setCredentials] = useState(dashboardData.credentials);
  const [bActivity, setbActivity] = useState(dashboardData.bActivity);
  const [topSites, setTopSites] = useState(dashboardData.topSites);
  const [evidences, setEvidences] = useState();

  const token = localStorage.getItem("token");

  const config = {
    headers: { Authorization: `Bearer ${token}` }
  };

  function fetchData() {
    !dashboardData.profile &&
      axios.get("/profile/estimate", config).then(res => {
        setProfile(res.data);
        dispatch(storeDashboardData({ profile: res.data }));
      });

    !dashboardData.accounts &&
      axios.get("/profile/accounts", config).then(res => {
        setAccounts(res.data);
        dispatch(storeDashboardData({ accounts: res.data }));
      });

    !dashboardData.systemSpecs &&
      axios.get("/profile/system-specs", config).then(res => {
        setSystemSpecs(res.data.specs);
        dispatch(storeDashboardData({ systemSpecs: res.data.specs }));
      });

    !dashboardData.classifiedUrls &&
      axios.get("/history/classify", config).then(res => {
        setClassifiedUrls(res.data.classified_urls);
        dispatch(
          storeDashboardData({ classifiedUrls: res.data.classified_urls })
        );
      });

    !dashboardData.credentials &&
      axios.get("/logindata/credentials", config).then(res => {
        setCredentials(res.data);
        dispatch(storeDashboardData({ credentials: res.data }));
      });

    !dashboardData.bActivity &&
      axios.get("/history/activity", config).then(res => {
        setbActivity(res.data);
        dispatch(storeDashboardData({ bActivity: res.data }));
      });

    !dashboardData.topSites &&
      axios.get("/topsites", config).then(res => {
        setTopSites(res.data);
        dispatch(storeDashboardData({ topSites: res.data }));
      });

    axios.get("/evidences", config).then(res => {
      setEvidences(res.data);
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
            <Profile profile={profile} accounts={accounts} />
          </Grid.Column>
          <Grid.Column>
            <SystemSpecs systemSpecs={systemSpecs} />
          </Grid.Column>
          <Grid.Column width={6}>
            <RadarWidget classified={classifiedUrls} />
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
            <UserActivity evidences={evidences || []} />
          </Grid.Column>
        </Grid.Row>
      </Grid>
    </ContentWrapper>
  );
}

export default DashboardContainer;
