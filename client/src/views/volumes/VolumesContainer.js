import React, { useState, useEffect } from "react";
import { ResponsiveSunburst } from "@nivo/sunburst";
import axios from "../../axios-api";
import { Grid, Segment, Header } from "semantic-ui-react";
import ContentWrapper from "../../layout/ContentWrapper/ContentWrapper";
import ReactJson from "react-json-view";
import { useDispatch, useSelector } from "react-redux";
import { storeDirTreeData } from "../../store/actions/appData";

function VolumesContainer() {
  const dispatch = useDispatch();
  const dirTreeData = useSelector(state => state.appDataReducer.dirTree);
  const [dirTree, setDirTree] = useState(dirTreeData);

  useEffect(() => {
    const token = localStorage.getItem("token");

    const config = {
      headers: { Authorization: `Bearer ${token}` },
      params: { count: 100 }
    };

    if (!dirTreeData) {
      axios.get("/volumes/tree", config).then(res => {
        setDirTree(res.data);
        dispatch(storeDirTreeData(res.data));
      });
    }
  });
  return (
    <ContentWrapper>
      <Grid columns="equal" stretched style={{ paddingBottom: "30px" }}>
        <Grid.Row>
          <Grid.Column width={6}>
            <Segment raised padded color="blue">
              <Header
                as="h1"
                content="Volume Directory Tree"
                subheader="Excluding: Service Worker, Extensions, IndexedDB"
              />
              <div style={{ height: "400px" }}>
                <ResponsiveSunburst
                  data={dirTree || []}
                  identity="name"
                  value="size"
                  cornerRadius={2}
                  borderWidth={1}
                  borderColor="white"
                  colors={{ scheme: "set3" }}
                  childColor={{ from: "color" }}
                  animate={true}
                  motionStiffness={90}
                  motionDamping={15}
                  isInteractive={true}
                />
              </div>
            </Segment>
          </Grid.Column>
          <Grid.Column>
            <Segment raised padded color="blue">
              <Header as="h1" content="Volume Structure" />
              <div style={{ height: "400px", overflowY: "scroll" }}>
                <ReactJson src={dirTree || []} />
              </div>
            </Segment>
          </Grid.Column>
        </Grid.Row>
      </Grid>
    </ContentWrapper>
  );
}

export default VolumesContainer;
