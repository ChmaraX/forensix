import React from "react";
import { Segment } from "semantic-ui-react";
import { GoogleMap, LoadScript, Marker } from "@react-google-maps/api";

const center = {
  lat: 48.14816,
  lng: 17.10674
};

function GoogleMaps() {
  return (
    <Segment color="blue" textAlign="center">
      <LoadScript
        id="script-loader"
        googleMapsApiKey="AIzaSyCH0m3Y3P_5VaO_8DBnW4hJj8v_kAw2RYg"
      >
        <GoogleMap
          id="data-example"
          mapContainerStyle={{
            height: "100%",
            width: "100%"
          }}
          zoom={13}
          center={center}
        ></GoogleMap>
      </LoadScript>
    </Segment>
  );
}

export default GoogleMaps;
