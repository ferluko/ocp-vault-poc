#!/bin/bash
exportfs
while :
do
 echo " enter the mount point name (empty to quit)"
 read e
 [ -z "$e" ] && break
 mkdir $e
 chown nfsnobody $e
 chgrp nfsnobody $e
 chmod 777 $e
 echo "$e *(rw,sync,no_root_squash)" | tee -a /etc/exports
 exportfs -r
 exportfs
done
