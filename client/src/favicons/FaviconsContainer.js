import React, { useState, useEffect } from "react";
import { Grid, Image, Segment, Input } from "semantic-ui-react";
import ContentWrapper from "../layout/ContentWrapper/ContentWrapper";
import _ from "lodash";
import axios from "axios";
import "./FaviconsContainer.css";
import FaviconsModal from "./components/FaviconModal";

function FaviconsContainer() {
  const [favicons, setFavicons] = useState();
  const [results, setResults] = useState();
  const [favModal, setFavModal] = useState({
    show: false,
    data: {}
  });

  useEffect(() => {
    axios.get("/favicons").then(res => {
      setFavicons(res.data);
      setResults(res.data);
    });
  }, []);

  const searchFavicon = keyword => {
    if (keyword.length < 1) return setResults(favicons);

    const re = new RegExp(_.escapeRegExp(keyword), "i");
    const isMatch = result => re.test(result.url);

    setResults(_.filter(favicons, isMatch));
  };

  const openFavicon = fav => {
    setFavModal({
      show: !favModal.show,
      data: fav
    });
  };

  return (
    <ContentWrapper>
      <Grid>
        <Grid.Row>
          <Grid.Column>
            <Input
              onChange={e => searchFavicon(e.target.value)}
              fluid
              size="big"
              icon="search"
              placeholder="Search..."
            />
          </Grid.Column>
        </Grid.Row>
        <FaviconsModal
          show={favModal.show}
          data={favModal.data}
          close={openFavicon}
        />
        {results?.map((fav, i) => {
          return (
            <Grid.Column stretched key={i}>
              <Segment
                raised
                className="favicon-tab"
                onClick={() => openFavicon(fav)}
              >
                <Image fluid src={fav.url} />
              </Segment>
            </Grid.Column>
          );
        })}
      </Grid>
    </ContentWrapper>
  );
}

export default FaviconsContainer;
