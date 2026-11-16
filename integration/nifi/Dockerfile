FROM apache/nifi:2.0.0
USER root
RUN mkdir -p /data/webshop/incoming /data/webshop/processed /data/webshop/reports /data/webshop/failed && chown -R nifi:nifi /data
COPY --chown=nifi:nifi tourwerk-order-intake.json /opt/nifi/flows/tourwerk-order-intake.json
COPY --chown=nifi:nifi sample/ /opt/nifi/flows/sample/
USER nifi
