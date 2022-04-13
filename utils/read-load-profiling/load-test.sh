#!/bin/bash

echo "Reading from $1"

line_count=$(cat $1 | wc -l  | tr -d ' ')
req_count=0

echo "Total endpoints: $line_count lines"

hostname="http://127.0.0.1"
port="3998"
profile_port="9119"
host="$hostname:$port"

curl "$hostname:$profile_port/profile/cpu/start" || {
    echo "CPU profiler request failed"
    exit 1
}

while read i
do
    ((req_count=req_count+1))
    if [[ $i == "/extended/v1/tokens/"* ]]
    then
        echo "Skipping $i"
    else
        percent=$(bc <<< "scale=3; $req_count / $line_count * 100")
        echo "Completed $req_count / $line_count, $percent%, hitting $i"
        curl --silent --output /dev/null --fail "$host$i" || {
            echo "Request failed to endpoint: $host$i"
            exit 1
        }
    fi
done < $1

curl -OJ "$hostname:$profile_port/profile/cpu/stop" || {
    echo "CPU profiler output request failed"
    exit 1
}
