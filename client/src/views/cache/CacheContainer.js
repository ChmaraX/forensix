import React, { useState, useEffect } from "react";
import ContentWrapper from "../../layout/ContentWrapper/ContentWrapper";
import SaveEvidenceModal from "../../common/SaveEvidenceModal/SaveEvidenceModal";
import MaterialTable from "material-table";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core";
import { Header, TextArea, Form } from "semantic-ui-react";
import axios from "axios";
import { useDispatch, useSelector } from "react-redux";
import { storeCacheData } from "../../store/actions/appData";

const theme = createMuiTheme({
  palette: {
    primary: {
      main: "rgb(111, 156, 235)"
    },
    secondary: {
      main: "rgb(111, 156, 235)"
    }
  }
});

function CacheContainer() {
  const dispatch = useDispatch();
  const cache = useSelector(state => state.appDataReducer.cache);
  const [cacheData, setCacheData] = useState(cache);
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  useEffect(() => {
    const token = localStorage.getItem("token");

    const config = {
      headers: { Authorization: `Bearer ${token}` },
      params: { count: 100 }
    };

    !cache &&
      axios.get("/cache", config).then(res => {
        setCacheData(res.data);
        dispatch(storeCacheData(res.data));
      });
  }, []);

  return (
    <ContentWrapper>
      <SaveEvidenceModal show={showModal.show} setShowModal={setShowModal} showModal={showModal}/>

      <MuiThemeProvider theme={theme}>
        <MaterialTable
          title={<Header as="h1">Cache Data</Header>}
          columns={[
            {
              title: "Creation Time",
              field: "creationTime"
            },
            {
              title: "URL",
              field: "keyData"
            },
            {
              title: "Entry State",
              field: "cacheEntryState"
            },
            {
              title: "Content Type",
              field: "contentType"
            },
            {
              title: "Reuse Count",
              field: "reuseCount"
            },
            {
              title: "Last Used",
              field: "rankings.lastUsed"
            },
            {
              title: "Last Modified",
              field: "rankings.lastModified"
            }
          ]}
          data={cacheData || []}
          actions={[
            {
              icon: "save",
              tooltip: "Mark as evidence",
              onClick: (event, rowData) =>
                setShowModal({
                  show: true,
                  data: rowData
                })
            }
          ]}
          options={{
            selection: true,
            exportButton: true,
            tableLayout: "auto",
            cellStyle: { overflow: "hidden" },
            searchFieldAlignment: "right",
            searchFieldStyle: { width: "500px" },
            pageSize: 10
          }}
          detailPanel={rowData => {
            if (rowData.contentType?.includes("image")) {
              var image = `data:${rowData.contentType};base64,${rowData.payload}`;
            }
            return (
              <div>
                {rowData.contentType?.includes("image") ? (
                  <img src={image} />
                ) : (
                  <Form>
                    <TextArea rows={10}>{rowData.payload}</TextArea>
                  </Form>
                )}
              </div>
            );
          }}
        />
      </MuiThemeProvider>
    </ContentWrapper>
  );
}

export default CacheContainer;
