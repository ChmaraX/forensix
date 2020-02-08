import React from "react";
import { Grid, Segment } from "semantic-ui-react";
import Sidemenu from "./Sidemenu/Sidemenu";
import TopBar from "./TopBar/TopBar";
import Profile from "./Widgets/Profile/Profile";

function DashboardContainer() {
  return (
    <div>
      <Sidemenu />
      <TopBar />
      <div style={{ margin: "30px 30px 30px 330px" }}>
        <Grid columns="equal">
          <Grid.Row>
            <Grid.Column width={6} style={{ maxHeight: "300px" }}>
              <Profile />
            </Grid.Column>
            <Grid.Column>
              <Segment>2</Segment>
              <Segment>2</Segment>
              <Segment>2</Segment>
            </Grid.Column>
            <Grid.Column width={6}>
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
