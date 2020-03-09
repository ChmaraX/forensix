import React, { useEffect, useState } from "react";
import axios from "../../axios-api";
import ContentWrapper from "../../layout/ContentWrapper/ContentWrapper";
import { Grid } from "semantic-ui-react";
import BrowsingActivty from "../dashboard/components/BrowsingActivity/BrowsingActivity";
import HistoryTable from "./components/HistoryTable/HistoryTable";
import AvgVisitChart from "./components/AvgVisitChart/AvgVisitChart";
import SaveEvidenceModal from "../../common/SaveEvidenceModal/SaveEvidenceModal";
import { useDispatch, useSelector } from "react-redux";
import { storeHistoryData } from "../../store/actions/appData";

function HistoryContainer() {
  const dispatch = useDispatch();
  const appData = useSelector(state => state.appDataReducer);
  const [history, setHistory] = useState(appData.history.history);
  const [bActivity, setbActivity] = useState(
    appData.dashboard.bActivity || appData.history.bActivity
  );
  const [avgDurations, setAvgDurations] = useState(
    appData.history.avgDurations
  );
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  const token = localStorage.getItem("token");

  const config = {
    headers: { Authorization: `Bearer ${token}` }
  };

  function fetchData() {
    !appData.history.history &&
      axios.get("/history", config).then(res => {
        setHistory(res.data);
        dispatch(storeHistoryData({ history: res.data }));
      });

    !appData.history.avgDurations &&
      axios.get("/history/avg", config).then(res => {
        setAvgDurations(res.data);
        dispatch(storeHistoryData({ avgDurations: res.data }));
      });

    !(appData.dashboard.bActivity || appData.history.bActivity) &&
      axios.get("/history/activity", config).then(res => {
        setbActivity(res.data);
        dispatch(storeHistoryData({ bActivity: res.data }));
      });
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <ContentWrapper>
      <Grid columns="equal" stretched style={{ paddingBottom: "30px" }}>
        <Grid.Row>
          <Grid.Column>
            <AvgVisitChart avgDurations={avgDurations} />
          </Grid.Column>
          <Grid.Column>
            <BrowsingActivty bActivity={bActivity} onlyHeatmap={true} />
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <SaveEvidenceModal
        show={showModal.show}
        setShowModal={setShowModal}
        showModal={showModal}
      />
      <HistoryTable history={history} setShowModal={setShowModal} />
    </ContentWrapper>
  );
}

export default HistoryContainer;
