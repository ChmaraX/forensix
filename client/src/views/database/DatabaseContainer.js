import React, { useEffect, useState } from "react";
import { Table, Header, Button, Image, Modal } from "semantic-ui-react";
import axios from "../../axios-api";
import ReactJson from "react-json-view";
import ContentWrapper from "../../layout/ContentWrapper/ContentWrapper";

function DatabaseContainer() {
  const [evidences, setEvidences] = useState([]);
  const [showModal, setShowModal] = useState({
    show: false,
    data: []
  });

  const token = localStorage.getItem("token");

  const config = {
    headers: { Authorization: `Bearer ${token}` }
  };

  useEffect(() => {
    axios.get("/evidences", config).then(res => {
      setEvidences(res.data);
    });
  }, []);

  const showData = data => {
    setShowModal({ show: true, data: data });
  };

  const dataModal = (
    <Modal
      open={showModal.show}
      onClose={() => setShowModal({ show: false, data: [] })}
      size="large"
    >
      <Header
        icon="database"
        content={`Database evidence record by ${showModal.data.fullname}`}
      />
      <Modal.Content>
        <div style={{ height: "400px", overflowY: "scroll" }}>
          <ReactJson src={showModal.data || []} />
        </div>
      </Modal.Content>
    </Modal>
  );

  return (
    <ContentWrapper>
      {dataModal}
      <Table celled fixed>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell width={3}>Name</Table.HeaderCell>
            <Table.HeaderCell width={2}>Created At</Table.HeaderCell>
            <Table.HeaderCell>Description</Table.HeaderCell>
            <Table.HeaderCell width={2}>Actions</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {evidences.map(
            ({ reporter, fullname, createdAt, description, data }) => (
              <Table.Row key={reporter}>
                <Table.Cell>
                  <Header as="h4" image>
                    <Image
                      src={
                        "https://react.semantic-ui.com/images/avatar/small/elliot.jpg"
                      }
                      rounded
                      size="mini"
                    />
                    <Header.Content>
                      {fullname}
                      <Header.Subheader>Investigator</Header.Subheader>
                    </Header.Content>
                  </Header>
                </Table.Cell>
                <Table.Cell>{new Date(createdAt).toDateString()}</Table.Cell>
                <Table.Cell>{description}</Table.Cell>
                <Table.Cell>
                  <Button fluid onClick={() => showData({ ...data, fullname })}>
                    Show Data
                  </Button>
                </Table.Cell>
              </Table.Row>
            )
          )}
        </Table.Body>
      </Table>
    </ContentWrapper>
  );
}

export default DatabaseContainer;
