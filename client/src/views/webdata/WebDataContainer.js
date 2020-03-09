import React, { useEffect, useState } from "react";
import axios from "../../axios-api";
import ContentWrapper from "../../layout/ContentWrapper/ContentWrapper";
import WebDataTable from "./components/WebDataTable";
import SaveEvidenceModal from "../../common/SaveEvidenceModal/SaveEvidenceModal";
import { Statistic, Grid, Segment, List, Header } from "semantic-ui-react";
import GoogleMaps from "./components/GoogleMaps";
import { useDispatch, useSelector } from "react-redux";
import { storeWebData } from "../../store/actions/appData";

const token = localStorage.getItem("token");

const config = {
  headers: { Authorization: `Bearer ${token}` }
};

function WebDataContainer() {
  const dispatch = useDispatch();
  const webData = useSelector(state => state.appDataReducer.webData);
  const [autofills, setAutofills] = useState(webData.autofills);
  const [geo, setGeo] = useState(webData.geo);
  const [phoneNums, setPhoneNums] = useState(webData.phoneNums);
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  function fetchData() {
    !webData.autofills &&
      axios.get("/webdata/autofills", config).then(res => {
        setAutofills(res.data);
        return res.data;
      });

    !webData.geo &&
      axios.get("/webdata/geo", config).then(res => {
        setGeo(res.data);
        dispatch(storeWebData({ geo: res.data }));
      });

    !webData.phoneNums &&
      axios.get("/webdata/phonenums", config).then(res => {
        setPhoneNums(res.data);
        dispatch(storeWebData({ phoneNums: res.data }));
      });
  }

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <ContentWrapper>
      <Grid columns="equal" stretched style={{ paddingBottom: "30px" }}>
        <Grid.Row>
          <Grid.Column width={4}>
            <Segment color="blue" textAlign="center">
              <Statistic size="tiny" color="blue">
                <Statistic.Label>City</Statistic.Label>
                <Statistic.Value>{geo?.probableCity}</Statistic.Value>
              </Statistic>
            </Segment>
            <Segment color="blue" textAlign="center">
              <Statistic size="tiny" color="blue">
                <Statistic.Label>Address</Statistic.Label>
                <Statistic.Value>{geo?.probableAddress}</Statistic.Value>
              </Statistic>
            </Segment>
            <Segment color="blue" textAlign="center">
              <Statistic size="tiny" color="blue">
                <Statistic.Label>Phone Number</Statistic.Label>
                <Statistic.Value>{phoneNums?.probableNum}</Statistic.Value>
              </Statistic>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <GoogleMaps />
          </Grid.Column>
          <Grid.Column>
            <Segment padded color="blue">
              <Grid columns={2}>
                <Grid.Column>
                  <Header as="h4">Possible cities and ZIP codes</Header>
                  <List
                    celled
                    style={{ overflowY: "scroll", maxHeight: "200px" }}
                  >
                    {geo?.cities.map(city => {
                      return <List.Item>{city}</List.Item>;
                    })}
                  </List>
                </Grid.Column>
                <Grid.Column>
                  <Header as="h4">Possible addresses</Header>
                  <List
                    celled
                    style={{ overflowY: "scroll", maxHeight: "200px" }}
                  >
                    {geo?.addresses.map(address => {
                      return <List.Item>{address}</List.Item>;
                    })}
                  </List>
                </Grid.Column>
              </Grid>
            </Segment>
          </Grid.Column>
        </Grid.Row>
      </Grid>
      <SaveEvidenceModal
        show={showModal.show}
        setShowModal={setShowModal}
        showModal={showModal}
      />
      <WebDataTable autofills={autofills} setShowModal={setShowModal} />
    </ContentWrapper>
  );
}

export default WebDataContainer;
