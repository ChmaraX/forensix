import React from "react";
import Sidemenu from "../Sidemenu/Sidemenu";
import TopBar from "../TopBar/TopBar";

function ContentWrapper(props) {
  return (
    <React.Fragment>
      <Sidemenu />
      <TopBar />
      <div style={{ margin: "30px 30px 30px 330px" }}>{props.children}</div>
    </React.Fragment>
  );
}

export default ContentWrapper;
