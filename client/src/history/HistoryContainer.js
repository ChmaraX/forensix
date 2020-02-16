import React, { useEffect, useState } from "react";
import { Table } from "semantic-ui-react";
import Sidemenu from "../layout/Sidemenu/Sidemenu";
import TopBar from "../layout/TopBar/TopBar";
import axios from "axios";

function HistoryContainer() {
  function fetchData() {}

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <React.Fragment>
      <Sidemenu />
      <TopBar />
      <div style={{ margin: "30px 30px 30px 330px" }}>
        <Table color="blue">
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Food</Table.HeaderCell>
              <Table.HeaderCell>Calories</Table.HeaderCell>
              <Table.HeaderCell>Protein</Table.HeaderCell>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            <Table.Row>
              <Table.Cell>Apples</Table.Cell>
              <Table.Cell>200</Table.Cell>
              <Table.Cell>0g</Table.Cell>
            </Table.Row>
            <Table.Row>
              <Table.Cell>Orange</Table.Cell>
              <Table.Cell>310</Table.Cell>
              <Table.Cell>0g</Table.Cell>
            </Table.Row>
          </Table.Body>
        </Table>
      </div>
    </React.Fragment>
  );
}

export default HistoryContainer;
