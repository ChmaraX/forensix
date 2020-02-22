import React, { useEffect, useState } from "react";
import axios from "axios";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";
import WebDataTable from "./components/WebDataTable";
import SaveEvidenceModal from "../common/SaveEvidenceModal/SaveEvidenceModal";
import {
  Statistic,
  Grid,
  Segment,
  List,
  Image,
  Header
} from "semantic-ui-react";
import GoogleMaps from "./components/GoogleMaps";

function WebDataContainer() {
  const [autofills, setAutofills] = useState();
  const [geo, setGeo] = useState();
  const [phoneNums, setPhoneNums] = useState();
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  function fetchData() {
    axios.get("/webdata/autofills").then(res => {
      setAutofills(res.data);
    });

    axios.get("/webdata/geo").then(res => {
      setGeo(res.data);
    });

    axios.get("/webdata/phonenums").then(res => {
      setPhoneNums(res.data);
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
      <SaveEvidenceModal show={showModal.show} setShowModal={setShowModal} />
      <WebDataTable autofills={autofills} setShowModal={setShowModal} />
    </ContentWrapper>
  );
}

export default WebDataContainer;
