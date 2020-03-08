import React, { useState, useEffect } from "react";
import ContentWrapper from "../../layout/ContentWrapper/ContentWrapper";
import SaveEvidenceModal from "../../common/SaveEvidenceModal/SaveEvidenceModal";
import MaterialTable from "material-table";
import { MuiThemeProvider, createMuiTheme } from "@material-ui/core";
import { Header } from "semantic-ui-react";
import { useDispatch, useSelector } from "react-redux";
import { storeLogindata } from "../../store/actions/appData";
import axios from "axios";

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

function LoginDataContainer() {
  const dispatch = useDispatch();
  const logindata = useSelector(state => state.appDataReducer.loginData);
  const [loginData, setLoginData] = useState(logindata);
  const [showModal, setShowModal] = useState({
    show: false,
    data: {}
  });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const config = {
      headers: { Authorization: `Bearer ${token}` }
    };

    !logindata &&
      axios.get("/logindata", config).then(res => {
        setLoginData(res.data);
        dispatch(storeLogindata(res.data));
      });
  }, []);

  return (
    <ContentWrapper>
      <SaveEvidenceModal show={showModal.show} setShowModal={setShowModal} showModal={showModal}/>

      <MuiThemeProvider theme={theme}>
        <MaterialTable
          title={<Header as="h1">Login Data</Header>}
          columns={[
            {
              title: "Action URL",
              field: "action_url"
            },
            {
              title: "Username",
              field: "username_value"
            },
            {
              title: "Password (hex)",
              field: "password_value"
            },
            { title: "Preferred", field: "preferred", type: "numeric" },
            { title: "Times Used", field: "times_used", type: "numeric" },
            { title: "Created", field: "date_created" },
            {
              title: "Last Used",
              field: "date_last_used"
            }
          ]}
          data={loginData || []}
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
        />
      </MuiThemeProvider>
    </ContentWrapper>
  );
}

export default LoginDataContainer;
